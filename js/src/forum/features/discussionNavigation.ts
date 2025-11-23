// js/src/forum/features/discussionNavigation.ts
import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import DiscussionListItem from 'flarum/forum/components/DiscussionListItem';
import Link from 'flarum/common/components/Link';

// flarum.extensions 全局：用于检测 v17 blog
// @ts-ignore
declare const flarum: any;

/** ---- v17 blog 路由判定（保持与你原来实现一致） ---- */
function shouldRedirectDiscussionToBlog(discussion: any): boolean {
  try {
    if (!flarum || !('v17development-blog' in flarum.extensions)) return false;
  } catch {
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

/** ---- URL / id 工具 ---- */

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

/**
 * 从前端 store 读取阅读位置：
 * - 若 lbReadingPosition 存在（哪怕是 1），视为“扩展已接管”，完全覆盖 lastReadPostNumber
 * - 若 lb 不存在，才 fallback 到 lastReadPostNumber (>1)
 */
type ReadingPositionSource = 'lb' | 'last' | null;
interface ReadingPosition {
  pos: number | null;
  source: ReadingPositionSource;
}

function readingPositionFromStore(id: string): ReadingPosition {
  const d = app.store.getById('discussions', id);
  if (!d) return { pos: null, source: null };

  const rawLb =
    typeof d.attribute === 'function'
      ? d.attribute('lbReadingPosition')
      : (d as any).lbReadingPosition;

  const rawLast =
    typeof d.lastReadPostNumber === 'function'
      ? d.lastReadPostNumber()
      : typeof d.attribute === 'function'
      ? d.attribute('lastReadPostNumber')
      : null;

  const hasLb = typeof rawLb === 'number';
  const lbNum = hasLb ? (rawLb as number) : null;
  const lastNum = typeof rawLast === 'number' ? (rawLast as number) : null;

  if (hasLb) {
    // 只要 lb 存在（即使是 1），就视为扩展接管，完全忽略 lastRead
    return { pos: lbNum, source: 'lb' };
  }

  if (lastNum && lastNum > 1) {
    return { pos: lastNum, source: 'last' };
  }

  return { pos: null, source: null };
}

/** 把 /d/:id[/slug] 改成 /d/:id[/slug]/:near（移除 ?near，去掉 #p123） */
function buildNearUrl(u: URL, near: number): string {
  const parts = u.pathname.split('/').filter(Boolean);
  const dIndex = parts.indexOf('d');
  if (dIndex === -1 || parts.length <= dIndex + 1) {
    return u.pathname + u.search + u.hash;
  }

  const prefix = '/' + parts.slice(0, dIndex + 2).join('/');
  u.pathname = `${prefix}/${near}`;
  u.searchParams.delete('near');
  if (u.hash && /^#p\d+$/i.test(u.hash)) u.hash = '';

  return u.pathname + u.search + u.hash;
}

let installed = false;

export default function installDiscussionNavigation() {
  if (installed) return;
  installed = true;

  app.initializers.add('lady-byron/reading-enhance-navigation', () => {
    /**
     * 1) 列表项改写（首页/标签页列表；搜索页不改，保留“最相关”体验）
     *    这里只用 lbReadingPosition 且只在 >1 时改写，语义就是“从记录楼层继续看”
     */
    extend(DiscussionListItem.prototype, 'view', function (vdom: any) {
      // 搜索页（params.q）不改写
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
                ? app.route('blogArticle.near', {
                    id: discussion.slug(),
                    near: recorded,
                  })
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

    /**
     * 2) Link.view 级别的通用 near 注入（只用 store，不打 API，不截获点击）
     *    - 若 lb 存在：
     *        lb > 1 → 用 lb
     *        lb <= 1 → 明确表示“从首楼开始”，不再 fallback 到 lastRead
     *    - 若 lb 不存在：
     *        lastRead > 1 → 用 lastRead
     */
    extend(Link.prototype as any, 'view', function (vdom: any) {
      const attrs = vdom.attrs || {};
      if (attrs['data-lbRewritten']) return;

      const href: string | undefined = attrs.href;
      if (typeof href !== 'string' || !href.trim()) return;

      let u: URL;
      try {
        u = new URL(href, app.forum.attribute('baseUrl'));
      } catch {
        return;
      }

      if (!sameOrigin(u)) return;

      const explicit = hasExplicitNear(u);
      if (explicit) return;

      const id = parseDiscussionIdFromUrl(u);
      if (!id) return;

      const rp = readingPositionFromStore(id);

      let near: number | null = null;

      if (rp.source === 'lb') {
        // 扩展已接管：lb > 1 才加 /near；lb <= 1 表示“从首楼开始”，不加 /1，也不看 lastRead
        if (rp.pos && rp.pos > 1) {
          near = rp.pos;
        }
      } else if (rp.source === 'last') {
        // 没有 lb 时，才使用 lastRead > 1
        if (rp.pos && rp.pos > 1) {
          near = rp.pos;
        }
      }

      if (!near || near <= 1) return;

      const target = buildNearUrl(u, near);
      vdom.attrs.href = target;
      vdom.attrs['data-lbRewritten'] = '1';
    });

    /**
     * 3) 钩住 app.route.discussion：所有用它生成的帖子链接都加 near（只用 store）
     *    - 若调用方显式传了 near 参数，则尊重调用方
     *    - 否则用 readingPositionFromStore 的结果
     */
    if ((app.route as any).discussion) {
      const oldDiscussionRoute = (app.route as any).discussion.bind(app.route);

      (app.route as any).discussion = function (discussion: any, near?: number) {
        try {
          let effectiveNear = near;

          const id =
            discussion?.id?.() ??
            (typeof discussion?.id === 'function' ? discussion.id() : discussion?.id);

          if (!effectiveNear && id) {
            const rp = readingPositionFromStore(String(id));

            if (rp.source === 'lb') {
              if (rp.pos && rp.pos > 1) {
                effectiveNear = rp.pos;
              }
            } else if (rp.source === 'last') {
              if (rp.pos && rp.pos > 1) {
                effectiveNear = rp.pos;
              }
            }
          }

          const url = oldDiscussionRoute(discussion, effectiveNear);

          // 若没有有效 near，直接返回原 URL
          if (!id || !effectiveNear || effectiveNear <= 1) {
            return url;
          }

          try {
            const u = new URL(url, app.forum.attribute('baseUrl'));
            const explicit = hasExplicitNear(u);
            if (explicit) return url;
            const final = buildNearUrl(u, effectiveNear);
            return final;
          } catch {
            return url;
          }
        } catch {
          return oldDiscussionRoute(discussion, near);
        }
      };
    }

    /**
     * 4) 兜底：程序化 m.route.set('/d/:id[..]') 时补一个 near（只用 store，不打 API）
     *    逻辑同上：lb 优先，lb=1 表示“首楼”，不再 fallback 到 lastRead
     */
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
                const rp = readingPositionFromStore(id);
                let near: number | null = null;

                if (rp.source === 'lb') {
                  if (rp.pos && rp.pos > 1) {
                    near = rp.pos;
                  }
                } else if (rp.source === 'last') {
                  if (rp.pos && rp.pos > 1) {
                    near = rp.pos;
                  }
                }

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
      } catch {
        // 忽略任何错误，保持原行为
      }

      // @ts-ignore
      return oldSet(path, data, options);
    };
  });
}
