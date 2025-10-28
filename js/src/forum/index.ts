import app from 'flarum/forum/app';
import { extend, override } from 'flarum/common/extend';
import DiscussionPage from 'flarum/forum/components/DiscussionPage';
import PostStream from 'flarum/forum/components/PostStream';

type Vnode = any;

function hasExplicitTarget(): boolean {
  // 显式 URL/near 始终优先
  const near = (m.route.param && m.route.param('near')) || null;
  const hash = (typeof window !== 'undefined' && window.location.hash) || '';
  return !!near || /^#p\d+$/i.test(hash);
}

function extractTopVisiblePostNumber(): number | null {
  // 兜底：从 DOM 计算“首个完全可见”的楼层号（Post DOM 带 data-number）
  const items = document.querySelectorAll<HTMLElement>('.PostStream-item[data-number]');
  const topOffset = 0; // 可按需扣掉页头高度
  for (const el of Array.from(items)) {
    const rect = el.getBoundingClientRect();
    if (rect.top >= topOffset && rect.bottom <= (window.innerHeight || 0)) {
      const num = parseInt(el.dataset.number || '', 10);
      if (num > 0) return num;
    }
  }
  return null;
}

function savePosition(discussionId: string, postNumber: number) {
  // 去抖：在 PostStream 内部已有 calculatePositionTimeout 节流，我们不再二次节流
  return app
    .request({
      method: 'POST',
      url: `${app.forum.attribute('apiUrl')}/discussions/${discussionId}/reading-position`,
      body: { postNumber },
    })
    .catch(() => {});
}

app.initializers.add('lady-byron/reading-enhance', () => {
  // 1) 覆盖开场定位：如果没有显式 near/hash，就用我们记录的阅读位置
  extend(DiscussionPage.prototype, 'oncreate', function () {
    if (!app.session.user) return;

    const discussion = (this as any).discussion;
    if (!discussion) return;

    const recorded: number | null = discussion.attribute('lbReadingPosition') || null;

    if (!hasExplicitTarget() && recorded && (this as any).stream) {
      // 延迟到下一帧，避免与核心初始定位竞争
      requestAnimationFrame(() => {
        (this as any).stream.goToNumber(recorded);
      });
    }
  });

  // 2) 在渲染树里给 PostStream 注入 onPositionChange 回调（复用官方时机/节流）
  override(DiscussionPage.prototype, 'view', function (original: any, ...args: any[]) {
    const vdom = original(...args);

    const inject = (node: Vnode) => {
      if (!node) return;
      if (Array.isArray(node)) return node.forEach(inject);
      if (node.children) inject(node.children);
      const tag = (node as any).tag;
      if (tag === PostStream) {
        node.attrs = node.attrs || {};
        const prev = node.attrs.onPositionChange;

        node.attrs.onPositionChange = (...cbArgs: any[]) => {
          // 先调用已有的回调，保持兼容
          if (typeof prev === 'function') prev(...cbArgs);

          if (!app.session.user) return;

          const dp = this as any;
          const discussion = dp?.discussion;
          if (!discussion) return;

          // “最后一次稳定停留的楼层”：优先用回调参数；若无，则用 DOM 兜底
          // 说明：PostStream 的 onPositionChange 被核心以节流时机触发，足够代表“稳定停留”:contentReference[oaicite:7]{index=7}
          let number: number | null = null;

          // 若未来需要，可根据 cbArgs 结构解析首/末可见楼层；此处用 DOM 方案更兼容
          number = extractTopVisiblePostNumber();

          if (number && typeof number === 'number') {
            // 需求：发新帖不强制把书签跳到自己新帖 —— 我们记录“首个完全可见楼层”，通常不会是最末回复
            savePosition(discussion.id(), number).then(() => {
              // 同步前端缓存，避免二次拉取
              const current = discussion.attribute('lbReadingPosition');
              if (current !== number) discussion.pushAttributes({ lbReadingPosition: number });
            });
          }
        };

        // 并且在没有显式 near/hash 时，把 targetPost 也定成我们记录的楼层（再次兜底）
        const discussion = (this as any).discussion;
        const recorded: number | null = discussion?.attribute('lbReadingPosition') || null;
        if (!hasExplicitTarget() && recorded) {
          node.attrs.targetPost = recorded;
        }
      }
    };

    inject(vdom);
    return vdom;
  });
});
