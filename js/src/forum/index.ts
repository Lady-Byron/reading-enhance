// js/src/forum/index.ts
import app from 'flarum/forum/app';
import { extend, override } from 'flarum/common/extend';
import DiscussionListItem from 'flarum/forum/components/DiscussionListItem';
import DiscussionPage from 'flarum/forum/components/DiscussionPage';
import PostStream from 'flarum/forum/components/PostStream';
import Link from 'flarum/common/components/Link';

// 尝试导入；某些构建里不存在该组件（会是 undefined）
import DiscussionSearchResult from 'flarum/forum/components/DiscussionSearchResult' as any;

/** —— 工具：判断链接是否已有显式目标（near=/d/.../N/#pN） —— */
function linkHasExplicitTarget(href: string): boolean {
  return /[?&]near=\d+/.test(href) || /\/d\/[^/]+\/\d+(?:[/?#]|$)/.test(href) || /#p\d+/.test(href);
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

/** 取视口顶部完全可见的楼层号（保存“最后稳定停留处”用） */
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

/** 递归找到 vnode 树里的第一个 <Link> */
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

/** 解析 /d/<id...> 形式的帖子链接里的 discussionId（仅取数字部分） */
function parseDiscussionIdFromHref(href: string): string | null {
  try {
    const u = new URL(href, window.location.origin);
    const m = u.pathname.match(/\/d\/(\d+)/);
    return m ? m[1] : null;
  } catch {
    const m = href.match(/\/d\/(\d+)/);
    return m ? m[1] : null;
  }
}

/** 读取记录值：优先从 store；没有就 GET /api/discussions/{id} 拉一次 */
const nearCache = new Map<string, number>();
async function getRecordedNearForHref(href: string): Promise<number | null> {
  const id = parseDiscussionIdFromHref(href);
  if (!id) return null;

  if (nearCache.has(id)) return nearCache.get(id)!;

  const disc = app.store.getById?.('discussions', id);
  let recorded: number | null = disc?.attribute?.('lbReadingPosition') ?? null;

  if (!recorded) {
    try {
      const json: any = await app.request({
        method: 'GET',
        url: `${app.forum.attribute('apiUrl')}/discussions/${id}`,
      });
      recorded = json?.data?.attributes?.lbReadingPosition ?? null;
    } catch {
      recorded = null;
    }
  }

  if (recorded && recorded > 1) nearCache.set(id, recorded);
  return recorded && recorded > 1 ? recorded : null;
}

app.initializers.add('lady-byron/reading-enhance', () => {
  /**
   * A) 列表入口：在 DiscussionListItem 的 <Link> 上追加 near
   *    （只在链接本身无显式目标且我们有记录值时）
   */
  extend(DiscussionListItem.prototype, 'view', function (vdom: any) {
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
   * B) 搜索入口：仅当组件存在时才扩展；否则走全局点击兜底
   */
  if (DiscussionSearchResult && DiscussionSearchResult.prototype) {
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
  }

  /**
   * C) 深链兜底：/d/slug 直接打开且无 near/#pN 时，替换为带 near 的同一路由
   */
  extend(DiscussionPage.prototype, 'show', function (_: any, discussion: any) {
    if (!discussion) return;

    const current = m.route.get();
    if (linkHasExplicitTarget(current)) return;

    const recorded: number | null = discussion.attribute('lbReadingPosition') ?? null;
    if (!recorded || recorded <= 1) return;

    const target = hrefWithNear(app.route.discussion(discussion), recorded);
    if (current !== target) {
      m.route.set(target, undefined, { replace: true });
    }
  });

  /**
   * D) 实时写库（官方节流回调）
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

  /**
   * E) 全局兜底点击：任何 /d/... 链接，若无显式目标，则点击时先查库再补 near 再导航
   *    - 只处理同窗口左键点击（避免干扰新窗口、复制链接等）
   */
  document.addEventListener('click', async (ev: any) => {
    const a: HTMLAnchorElement | null = ev.target?.closest?.('a');
    if (!a) return;

    // 非同域、带 target、带修饰键、已显式指向楼层的链接，一律跳过
    if (a.target && a.target !== '' && a.target !== '_self') return;
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const href = a.getAttribute('href') || '';
    if (!/\/d\//.test(href)) return;
    if (linkHasExplicitTarget(href)) return;

    // 尝试获取记录值（store 或 GET /api/discussions/{id}）
    const recorded = await getRecordedNearForHref(href);
    if (!recorded) return; // 没有记录就尊重原链接

    ev.preventDefault();
    const target = hrefWithNear(href, recorded);
    // 使用 Mithril 导航，保持 SPA 体验
    m.route.set(target);
  }, { capture: true });
});
