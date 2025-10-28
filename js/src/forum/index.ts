import app from 'flarum/forum/app';
import DiscussionPage from 'flarum/forum/components/DiscussionPage';
import PostStream from 'flarum/forum/components/PostStream';
import { extend, override } from 'flarum/common/extend';

function hasExplicitTarget(): boolean {
  const near = (m.route.param && m.route.param('near')) || null;
  const hash = (typeof window !== 'undefined' && window.location.hash) || '';
  return !!near || /^#p\d+$/i.test(hash);
}

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

function savePosition(discussionId: string, postNumber: number) {
  return app
    .request({
      method: 'POST',
      // ✅ 使用不与 JSON:API 关系端点冲突的新路由
      url: `${app.forum.attribute('apiUrl')}/ladybyron/reading-position/${discussionId}`,
      body: { postNumber },
    })
    .catch(() => {});
}

app.initializers.add('lady-byron/reading-enhance', () => {
  // 打开时：若无显式 URL/near，则用书签位覆盖初始定位
  extend(DiscussionPage.prototype, 'oncreate', function () {
    if (!app.session.user) return;
    const discussion = (this as any).discussion;
    const recorded: number | null = discussion?.attribute('lbReadingPosition') ?? null;
    if (!hasExplicitTarget() && recorded && (this as any).stream) {
      requestAnimationFrame(() => (this as any).stream.goToNumber(recorded));
    }
  });

  // 在 PostStream 的官方“位置变更”节流时机里写库
  override(DiscussionPage.prototype, 'view', function (original: any, ...args: any[]) {
    const vdom = original(...args);

    const inject = (node: any) => {
      if (!node) return;
      if (Array.isArray(node)) return node.forEach(inject);
      if (node.children) inject(node.children);

      if (node.tag === PostStream) {
        node.attrs = node.attrs || {};

        const prev = node.attrs.onPositionChange;
        node.attrs.onPositionChange = (...cbArgs: any[]) => {
          if (typeof prev === 'function') prev(...cbArgs);
          if (!app.session.user) return;
          const dp = this as any;
          const discussion = dp?.discussion;
          if (!discussion) return;

          const n = extractTopFullyVisiblePostNumber();
          if (n && typeof n === 'number') {
            savePosition(discussion.id(), n).then(() => {
              if (discussion.attribute('lbReadingPosition') !== n) {
                discussion.pushAttributes({ lbReadingPosition: n });
              }
            });
          }
        };

        // 再次兜底：若无显式 URL/near，用书签位作为 targetPost
        const discussion = (this as any).discussion;
        const recorded: number | null = discussion?.attribute('lbReadingPosition') ?? null;
        if (!hasExplicitTarget() && recorded) {
          node.attrs.targetPost = recorded;
        }
      }
    };

    inject(vdom);
    return vdom;
  });
});
