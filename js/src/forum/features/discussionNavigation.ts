// js/src/forum/features/discussionNavigation.ts
import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import DiscussionListItem from 'flarum/forum/components/DiscussionListItem';
import Link from 'flarum/common/components/Link';

/** ---- v17 blog 路由判定（与你现有实现一致） ---- */
function shouldRedirectDiscussionToBlog(discussion: any): boolean {
  // @ts-ignore
  if (!(window as any).flarum || !('v17development-blog' in (window as any).flarum.extensions)) {
    return false;
  }

  const redirects = app.forum.attribute('blogRedirectsEnabled');
  const discussionRedirectEnabled =
    redirects === 'both' || redirects === 'discussions_only';

  const tags = discussion.tags?.() || [];
  if (!discussionRedirectEnabled || tags.length === 0) return false;

  const blogTags = app.forum.attribute<string[]>('blogTags') || [];

  return tags.some((tag: any) => {
    if (!tag) return false;
    const parent = tag.parent?.() || null;
    return (
      blogTags.indexOf(tag.id?.()!) !== -1 ||
      (parent && blogTags.indexOf(parent.id?.()!) !== -1)
    );
  });
}

/** ---- URL 工具 ---- */
function sameOrigin(u: URL): boolean {
  try {
    const base = new URL(app.forum.attribute('baseUrl'));
    return u.origin === base.origin;
  } catch {
    return false;
  }
}

function parseDiscussionIdFromUrl(u: URL): string | null {
  const parts = u.pathname.split('/').filter(Boolean);
  const dIndex = parts.indexOf('d');
  if (dIndex === -1 || parts.length <= dIndex + 1) return null;
  const idPart = parts[dIndex + 1];
  const match = /^(\d+)/.exec(idPart);
  return match ? match[1] : null;
}

/** 显式 near 识别：数字 | 'first' | 'last' | #p123 | #reply/#last/#first */
function hasExplicitNear(u: URL): number | 'first' | 'last' | null {
  const parts = u.pathname.split('/').filter(Boolean);
  const dIndex = parts.indexOf('d');

  // /d/:id/:near（数字）
  if (dIndex !== -1 && parts.length > dIndex + 2) {
    const n = parseInt(parts[dIndex + 2], 10);
    if (!Number.isNaN(n) && n > 0) return n; // near=1 也视为显式
  }

  // ?near=（数字 | first | last）
  const nearRaw = u.searchParams.get('near');
  if (nearRaw) {
    const n = parseInt(nearRaw, 10);
    if (!Number.isNaN(n) && n > 0) return n;
    const s = nearRaw.toLowerCase();
    if (s === 'first') return 'first';
    if (s === 'last') return 'last';
  }

  // 锚点：#p123 / #reply / #last / #first
  if (u.hash) {
    const h = u.hash.toLowerCase();
    if (/^#p\d+$/.test(h)) return parseInt(h.slice(2), 10);
    if (h === '#reply' || h === '#last') return 'last';
    if (h === '#first') return 'first';
  }
  return null;
}

/** 从前端 store 读取 near（lbReadingPosition > lastReadPostNumber > null） */
function nearFromStore(id: string): number | null {
  const d = app.store.getById('discussions', id);
  if (!d) return null;

  const lb =
    typeof d.attribute === 'function'
      ? d.attribute('lbReadingPosition')
      : (d as any).lbReadingPosition;

  const last =
    typeof d.lastReadPostNumber === 'function'
      ? d.lastReadPostNumber()
      : typeof d.attribute === 'function'
      ? d.attribute('lastReadPostNumber')
      : null;

  const lbNum = typeof lb === 'number' ? lb : null;
  const lastNum = typeof last === 'number' ? last : null;

  return lbNum && lbNum > 1
    ? lbNum
    : lastNum && lastNum > 1
    ? lastNum
    : null;
}

/** 把 /d/:id[/slug] 改成 /d/:id[/slug]/:near（移除 ?near，目前也不用 hash #p123） */
function buildNearUrl(u: URL, near: number): string {
  const parts = u.pathname.split('/').filter(Boolean);
  const dIndex = parts.indexOf('d');
  if (dIndex === -1 || parts.length <= dIndex + 1) return u.pathname + u.search + u.hash;

  const prefix = '/' + parts.slice(0, dIndex + 2).join('/');
  u.pathname = `${prefix}/${near}`;
  u.searchParams.delete('near');
  if (u.hash && /^#p\d+$/i.test(u.hash)) u.hash = '';

  return u.pathname + u.search + u.hash;
}

let attached = false;

export default function installDiscussionNavigation() {
  if (attached) return;
  attached = true;

  app.initializers.add('lady-byron/reading-enhance-navigation', () => {
    /** 1) 列表项改写（保留 v17 blog 支持 & 搜索页特例） */
    extend(DiscussionListItem.prototype, 'view', function (vdom: any) {
      // 搜索页（params.q）不改写，保留“最相关”体验
      if ((this as any).attrs?.params?.q) return;

      const discussion = (this as any).attrs?.discussion;
      if (!discussion) return;

      const recorded: number | null = discussion.attribute('lbReadingPosition') ?? null;
      if (!recorded || recorded <= 1) return;

      (vdom.children as any[]).forEach((child: any) => {
        if (
          !child ||
          !child.attrs ||
          !child.attrs.className ||
          child.attrs.className.indexOf('DiscussionListItem-content') === -1
        ) {
          return;
        }

        (child.children as any[]).forEach((sub: any) => {
          if (!sub || sub.tag !== Link) return;

          let href: string;

          if (shouldRedirectDiscussionToBlog(discussion)) {
            href =
              recorded > 1
                ? app.route('blogArticle.near', { id: discussion.slug(), near: recorded })
                : app.route('blogArticle', { id: discussion.slug() });
          } else {
            href = app.route.discussion(discussion, recorded);
          }

          sub.attrs = sub.attrs || {};
          sub.attrs.href = href;
          sub.attrs['data-lbRewritten'] = '1';
        });
      });
    });

    /** 2) Link.view 级别的通用 near 注入（不打 API） */
    extend(Link.prototype as any, 'view', function (vdom: any) {
      const attrs = vdom.attrs || {};
      if (attrs['data-lbRewritten']) return;

      const href: string | undefined = attrs.href;
      if (typeof href !== 'string' || !href.trim()) return;

      let u: URL;
      try {
        // 用 baseUrl 作为相对根，兼容相对路径
        u = new URL(href, app.forum.attribute('baseUrl'));
      } catch {
        return;
      }

      if (!sameOrigin(u)) return;

      // 显式 near（含 first/last/#p123/#reply）一律尊重
      const explicit = hasExplicitNear(u);
      if (explicit) return;

      const id = parseDiscussionIdFromUrl(u);
      if (!id) return;

      const near = nearFromStore(id);
      if (!near || near <= 1) return;

      const target = buildNearUrl(u, near);
      vdom.attrs.href = target;
      vdom.attrs['data-lbRewritten'] = '1';
    });

    /** 3) 兜底补丁：任何地方调用 m.route.set('/d/:id[..]') 时，如果我们有 near，就补上 */
    // @ts-ignore
    const oldSet = m.route.set.bind(m.route);
    // @ts-ignore
    m.route.set = function (path: string, data?: any, options?: any) {
      try {
        if (typeof path === 'string') {
          const url = new URL(path, window.location.origin);
          const parts = url.pathname.split('/').filter(Boolean);
          const dIndex = parts.indexOf('d');

          if (dIndex !== -1 && parts.length > dIndex + 1) {
            const hasNearPath =
              parts.length > dIndex + 2 && /^\d+$/.test(parts[dIndex + 2]);
            const hasNearQuery = url.searchParams.has('near'); // near=first/last 也算显式

            if (!hasNearPath && !hasNearQuery) {
              const idPart = parts[dIndex + 1];
              const idMatch = /^(\d+)/.exec(idPart);
              const id = idMatch ? idMatch[1] : null;

              if (id) {
                const near = nearFromStore(id);
                if (near && near > 1) {
                  const prefix = '/' + parts.slice(0, dIndex + 2).join('/');
                  url.pathname = `${prefix}/${near}`;
                  url.searchParams.delete('near');
                  path = url.pathname + url.search + url.hash;
                }
              }
            }
          }
        }
      } catch {}

      // @ts-ignore
      return oldSet(path, data, options);
    };
  });
}
