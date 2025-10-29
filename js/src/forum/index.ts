// js/src/forum/index.ts
import app from 'flarum/forum/app';
import { extend, override } from 'flarum/common/extend';
import DiscussionListItem from 'flarum/forum/components/DiscussionListItem';
import DiscussionPage from 'flarum/forum/components/DiscussionPage';
import PostStream from 'flarum/forum/components/PostStream';
import Link from 'flarum/common/components/Link';

// 可选加载：部分环境下没有单独暴露该组件
let DiscussionSearchResult: any = null;
try {
  // 静态字符串 require 便于打包器解析
  // @ts-ignore
  DiscussionSearchResult = require('flarum/forum/components/DiscussionSearchResult').default;
} catch { /* noop */ }

/** 链接是否已显式指向某楼层：?near=、/d/.../N、#pN */
function linkHasExplicitTarget(href: string): boolean {
  return /[?&]near=\d+/.test(href) || /\/d\/[^/]+\/\d+(?:[/?#]|$)/.test(href) || /#p\d+/.test(href);
}

/** 在现有 href 上补充 near（相对/绝对链接均可），返回相对路径以避免整页刷新 */
function hrefWithNear(href: string, near: number): string {
  try {
    const u = new URL(href, window.location.origin);
    if (!u.searchParams.has('near')) u.searchParams.set('near', String(near));
    return u.pathname + u.search + u.hash;
  } catch {
    return href + (href.includes('?') ? '&' : '?') + 'near=' + near;
  }
}

/** 取视口顶部“完全可见”的楼层号（用于“最后稳定停留处”） */
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

/** 将阅读位置写入后端（静默失败即可） */
function savePosition(discussionId: string, postNumber: number) {
  return app
    .request({
      method: 'POST',
      url: `${app.forum.attribute('apiUrl')}/ladybyron/reading-position`,
      body: { discussionId, postNumber },
    })
    .catch(() => {});
}

/** 在 vnode 树里找到第一个 <Link> 节点 */
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

/** 从 /d/<id...> 形式的链接解析出 discussionId（取数字） */
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

/** 读取记录值：优先从 store 拿；没有就 GET /api/discussions/{id} 拉一次；缓存结果 */
const nearCache = new Map<string, number>();
async function getRecordedNearForHref(href: string): Promise<number | null> {
  const id = parseDiscussionIdFromHref(href);
  if (!id) return null;

  if (nearCache.has(id)) return nearCache.get(id)!;

  const disc = (app.store as any).getById?.('discussions', id);
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
   * A) 讨论列表入口（首页、标签、关注/未读、以及“全页搜索结果”都复用 DiscussionListItem）
   *    若链接无显式目标且我们有书签，就在 <Link> 上补 ?near=记录楼层
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
   * B) 搜索下拉入口（存在时扩展 DiscussionSearchResult；否则靠全局点击兜底）
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
   * C) 深链兜底：直接打开 /d/slug 且无 near/#pN 时，用 replace 无刷新替换为带 near 的 URL，
   *    然后交给核心 Resolver 完成定位（不污染历史栈）
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
   * D) 实时写库：复用官方 PostStream 的节流回调
   *    记录“最后稳定停留处”，并将值 push 回模型（供上面改写逻辑立即可用）
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
   * E) 全局点击兜底：任意 /d/... 链接，若无显式目标，则点击瞬间“先查记录再补 near 再导航”
   *    - 仅处理同窗口左键点击（避免干扰新窗口/复制链接等）
   *    - 这样可覆盖第三方入口、搜索下拉在某些构建环境缺组件导出等情况
   */
  document.addEventListener('click', async (ev: any) => {
    const a: HTMLAnchorElement | null = ev.target?.closest?.('a');
    if (!a) return;

    if (a.target && a.target !== '' && a.target !== '_self') return;
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;

    const href = a.getAttribute('href') || '';
    if (!/\/d\//.test(href)) return;            // 只关心帖子链接
    if (linkHasExplicitTarget(href)) return;    // 已显式指向的尊重原样

    // 读取记录值（store 命中或 GET 一次 discussions/{id}）
    const recorded = await getRecordedNearForHref(href);
    if (!recorded) return; // 无记录则放行原链接

    ev.preventDefault();
    const target = hrefWithNear(href, recorded);
    m.route.set(target); // 交给核心 Resolver/PostStreamState 定位
  }, { capture: true });
});
