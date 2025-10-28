// js/src/forum/index.ts
import app from 'flarum/forum/app';
import { extend, override } from 'flarum/common/extend';
import DiscussionListItem from 'flarum/forum/components/DiscussionListItem';
import DiscussionPage from 'flarum/forum/components/DiscussionPage';
import PostStream from 'flarum/forum/components/PostStream';
import Link from 'flarum/common/components/Link';

/** URL 是否已有显式目标（near 或 #p123）——供将来扩展使用 */
function hasExplicitTarget(): boolean {
  const near = (m.route.param && m.route.param('near')) || null;
  const hash = (typeof window !== 'undefined' && window.location.hash) || '';
  return !!near || /^#p\d+$/i.test(hash);
}

/** 取视口内顶部完全可见楼层号，用于“最后稳定停留处”写库 */
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

/** 将阅读位置写入后端（静默失败，不打断 UI） */
function savePosition(discussionId: string, postNumber: number) {
  return app
    .request({
      method: 'POST',
      url: `${app.forum.attribute('apiUrl')}/ladybyron/reading-position`, // 后端已接好的“无路径参数”路由
      body: { discussionId, postNumber },
    })
    .catch(() => {});
}

/** 递归找到 DiscussionListItem 内部的第一个 <Link> vnode 并返回 */
function findFirstLinkVNode(node: any): any | null {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findFirstLinkVNode(child);
      if (hit) return hit;
    }
    return null;
  }
  if (node.tag === Link) return node;
  if (node.children) return findFirstLinkVNode(node.children);
  return null;
}

app.initializers.add('lady-byron/reading-enhance', () => {
  /**
   * A) 改写“讨论列表项”链接：把 near=记录楼层 写入 URL
   *    - 跳过搜索页（保留搜索“最相关楼层”原行为）
   *    - 仅当我们确有记录值时改写
   */
  extend(DiscussionListItem.prototype, 'view', function (vdom: any) {
    // 搜索结果页：this.attrs.params.q 存在
    if ((this as any).attrs?.params?.q) return;

    const discussion = (this as any).attrs?.discussion;
    if (!discussion) return;

    const recorded: number | null = discussion.attribute('lbReadingPosition') ?? null;
    if (!recorded || recorded <= 1) return;

    // 找到内部第一个 <Link>，改写 href
    const link = findFirstLinkVNode(vdom);
    if (link && link.attrs) {
      link.attrs.href = app.route.discussion(discussion, recorded);
    }
  });

  /**
   * B) 继续使用核心“位置变更节流回调”实时写库
   */
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
              // 同步到前端模型，便于后续列表改写使用
              if (discussion.attribute('lbReadingPosition') !== n) {
                discussion.pushAttributes({ lbReadingPosition: n });
              }
            });
          }
        };
      }
    };

    inject(vdom);
    return vdom;
  });
});
