// js/src/forum/index.ts
import app from 'flarum/forum/app';
import DiscussionPage from 'flarum/forum/components/DiscussionPage';
import PostStream from 'flarum/forum/components/PostStream';
import { extend, override } from 'flarum/common/extend';

/** 是否存在显式目标（URL near 或 #p123 锚点） */
function hasExplicitTarget(): boolean {
  const near = (m.route.param && m.route.param('near')) || null;
  const hash = (typeof window !== 'undefined' && window.location.hash) || '';
  return !!near || /^#p\d+$/i.test(hash);
}

/** 提取视口内顶部完全可见的楼层号（用于“最后稳定停留处”存盘） */
function extractTopFullyVisiblePostNumber(): number | null {
  const items = document.querySelectorAll<HTMLElement>('.PostStream-item[data-number]');
  for (const el of Array.from(items)) {
    const rect = el.getBoundingClientRect();
    if (rect.top >= 0 && rect.bottom <= (window.innerHeight || 0)) {
      const n = parseInt(el.dataset.number || '', 10);
      if (n > 0) return n;
    }
  }
  return null;
}

/** 将阅读位置写入后端（静默失败即可，不打断 UI） */
function savePosition(discussionId: string, postNumber: number) {
  return app
    .request({
      method: 'POST',
      url: `${app.forum.attribute('apiUrl')}/ladybyron/reading-position`,
      body: { discussionId, postNumber },
    })
    .catch(() => {});
}

app.initializers.add('lady-byron/reading-enhance', () => {
  /**
   * 关键修正：
   * 1) 不再给 <PostStream> vnode 塞 targetPost
   * 2) 而是给 PostStreamState（即 this.stream）设置 targetPost
   *    这样才能被核心的首屏定位逻辑消费
   */

  // 在 oninit（核心创建 this.stream 之后）尽早注入目标楼层
  extend(DiscussionPage.prototype, 'oninit', function () {
    if (!app.session.user) return;

    const discussion = (this as any).discussion;
    const recorded: number | null = discussion?.attribute('lbReadingPosition') ?? null;

    if (!hasExplicitTarget() && recorded && (this as any).stream) {
      // ✅ 正确位置：直接写 state
      (this as any).stream.targetPost = { number: recorded };
      // 标一下面向下一次 update 的需求（兼容某些时序）
      (this as any).stream.needsScroll = true;
    }
  });

  // oncreate 再兜底一次（有些情况下数据到位稍晚）
  extend(DiscussionPage.prototype, 'oncreate', function () {
    if (!app.session.user) return;

    const dp = this as any;
    const discussion = dp.discussion;
    const recorded: number | null = discussion?.attribute('lbReadingPosition') ?? null;

    if (!hasExplicitTarget() && recorded && dp.stream) {
      // 若核心在 oninit 之后又改写了 target（例如无未读时跳末帖），这里再覆盖一次
      dp.stream.targetPost = { number: recorded };
      dp.stream.needsScroll = true;

      // 触发一次更新让 targetPost 生效（无动画，避免首屏晃动）
      dp.stream.goToNumber(recorded, true);
    }
  });

  // 将“最后稳定停留处”保存落库：复用核心节流回调
  override(DiscussionPage.prototype, 'view', function (original: any, ...args: any[]) {
    const vdom = original(...args);

    const inject = (node: any) => {
      if (!node) return;
      if (Array.isArray(node)) return node.forEach(inject);
      if (node.children) inject(node.children);

      if (node.tag === PostStream) {
        node.attrs = node.attrs || {};

        // 1) 继续复用/尊重核心的 onPositionChange
        const prev = node.attrs.onPositionChange;
        node.attrs.onPositionChange = (...cbArgs: any[]) => {
          if (typeof prev === 'function') prev(...cbArgs);
          if (!app.session.user) return;

          const dp = (this as any);
          const discussion = dp?.discussion;
          if (!discussion) return;

          const n = extractTopFullyVisiblePostNumber();
          if (n && typeof n === 'number') {
            savePosition(discussion.id(), n).then(() => {
              // 同步到前端模型，便于后续再次进入本帖立即可用
              if (discussion.attribute('lbReadingPosition') !== n) {
                discussion.pushAttributes({ lbReadingPosition: n });
              }
            });
          }
        };

        // 2) ❌ 不再：node.attrs.targetPost = recorded
        //    因为 <PostStream> 并不消费这个 prop；真正消费者是 state（this.stream.targetPost）
        //    见 Flarum 1.8 PostStreamState 文档：targetPost 属性由 state/内部方法使用。
      }
    };

    inject(vdom);
    return vdom;
  });
});

