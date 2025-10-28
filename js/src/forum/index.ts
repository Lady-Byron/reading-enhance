// js/src/forum/index.ts
import app from 'flarum/forum/app';
import { extend, override } from 'flarum/common/extend';
import DiscussionListItem from 'flarum/forum/components/DiscussionListItem';
import DiscussionSearchResult from 'flarum/forum/components/DiscussionSearchResult';
import DiscussionPage from 'flarum/forum/components/DiscussionPage';
import PostStream from 'flarum/forum/components/PostStream';
import Link from 'flarum/common/components/Link';

/** —— 工具：判断链接是否已有显式目标（尊重不改） —— */
function linkHasExplicitTarget(href: string): boolean {
  return /[?&]near=\d+/.test(href)        // ?near=123
      || /\/d\/[^/]+\/\d+(?:[/?#]|$)/.test(href) // /d/slug-or-id/123
      || /#p\d+/.test(href);              // #p123
}

/** 给已有 href 追加 near（相对/绝对 href 都可） */
function hrefWithNear(href: string, near: number): string {
  try {
    const u = new URL(href, window.location.origin);
    if (!u.searchParams.has('near')) u.searchParams.set('near', String(near));
    return u.pathname + u.search + u.hash; // 返回相对地址，避免整页刷新
  } catch {
    return href + (href.includes('?') ? '&' : '?') + 'near=' + near;
  }
}

/** 取“视口顶部完全可见”的楼层号（作为“最后稳定停留处”） */
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

/** 写库（静默失败即可） */
function savePosition(discussionId: string, postNumber: number) {
  return app
    .request({
      method: 'POST',
      url: `${app.forum.attribute('apiUrl')}/ladybyron/reading-position`,
      body: { discussionId, postNumber },
    })
    .catch(() => {});
}

/** 递归在 vnode 树里找第一个 <Link> 节点 */
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
   * A. 讨论列表入口（首页、标签、关注/未读等都复用 DiscussionListItem）
   *    若链接无显式目标且我们有记录值，则在 <Link> 上注入 ?near=记录楼层
   */
  extend(DiscussionListItem.prototype, 'view', function (vdom: any) {
    const discussion = (this as any).attrs?.discussion;
    if (!discussion) return;

    const recorded: number | null = discussion.attribute('lbReadingPosition') ?? null;
    if (!recorded || recorded <= 1) return;

    const link = findFirstLinkVNode(vdom);
    if (!link || !link.attrs?.href) return;

    const oldHref: string = link.attrs.href;
    if (linkHasExplicitTarget(oldHref)) return; // 已经指明楼层，尊重

    link.attrs.href = hrefWithNear(oldHref, recorded);
  });

  /**
   * B. 搜索结果入口（快速搜索下拉 & 搜索页都用 DiscussionSearchResult）
   *    同样规则：只在“无显式目标且我们有记录值”时追加 near
   */
  extend(DiscussionSearchResult.prototype, 'view', function (vdom: any) {
    const discussion = (this as any).attrs?.discussion;
    if (!discussion) return;

    const recorded: number | null = discussion.attribute('lbReadingPosition') ?? null;
    if (!recorded || recorded <= 1) return;

    const link = findFirstLinkVNode(vdom);
    if (!link || !link.attrs?.href) return;

    const oldHref: string = link.attrs.href;
    if (linkHasExplicitTarget(oldHref)) return;

    link.attrs.href = hrefWithNear(oldHref, recorded);
  });

  /**
   * C. 深链兜底：用户直接打开 /d/slug（没有 near/#pN）时
   *    在 DiscussionPage.show 里用 replace 把 URL 替换为带 near 的版本，
   *    再交给核心 Resolver 完成定位（不会污染历史栈）
   */
  extend(DiscussionPage.prototype, 'show', function (_: any, discussion: any) {
    if (!discussion) return;

    const current = m.route.get();
    if (linkHasExplicitTarget(current)) return; // 有显式目标就尊重

    const recorded: number | null = discussion.attribute('lbReadingPosition') ?? null;
    if (!recorded || recorded <= 1) return;

    const target = hrefWithNear(app.route.discussion(discussion), recorded);
    if (current !== target) {
      m.route.set(target, undefined, { replace: true });
    }
  });

  /**
   * D. 继续使用核心“位置变更节流回调”实时写库
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
