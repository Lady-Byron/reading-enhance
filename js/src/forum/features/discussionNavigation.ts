// js/src/forum/features/discussionNavigation.ts
import app from 'flarum/forum/app';
import { override } from 'flarum/common/extend';
import DiscussionListItem from 'flarum/forum/components/DiscussionListItem';

// @ts-ignore
declare const flarum: any;

/** ---- v17 blog 路由判定 ---- */
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
    // #12: 用安全取值替代矛盾的 ?.()! 写法
    const tagId = tag.id?.() ?? tag.id ?? null;
    const parent = tag.parent?.() || null;
    const parentId = parent ? (parent.id?.() ?? parent.id ?? null) : null;
    return (
      (tagId != null && blogTags.indexOf(tagId) !== -1) ||
      (parentId != null && blogTags.indexOf(parentId) !== -1)
    );
  });
}

/**
 * #14: 提取公共 helper — 从 store 读取有效阅读位置
 * - lbReadingPosition 存在（哪怕 =1）→ 扩展已接管：>1 返回值，<=1 返回 null（从首楼开始）
 * - lbReadingPosition 不存在 → fallback 到 lastReadPostNumber (>1)
 */
function effectiveNearFromStore(id: string): number | null {
  const d = app.store.getById('discussions', id);
  if (!d) return null;

  const rawLb =
    typeof d.attribute === 'function'
      ? d.attribute('lbReadingPosition')
      : (d as any).lbReadingPosition;

  if (typeof rawLb === 'number') {
    return rawLb > 1 ? rawLb : null;
  }

  const rawLast =
    typeof d.lastReadPostNumber === 'function'
      ? d.lastReadPostNumber()
      : typeof d.attribute === 'function'
      ? d.attribute('lastReadPostNumber')
      : null;

  return typeof rawLast === 'number' && rawLast > 1 ? rawLast : null;
}

// 搜索页抑制标志：在搜索列表渲染期间禁止注入 near，保持"最相关"语义
let _suppressNear = false;

let installed = false;

export default function installDiscussionNavigation() {
  if (installed) return;
  installed = true;

  app.initializers.add('lady-byron/reading-enhance-navigation', () => {
    const DBG = true; // ← 诊断开关，定位完毕后改为 false

    // ---- 诊断：检查 app.route.discussion 是否存在 ----
    const hasDiscussionRoute = !!(app.route as any).discussion;
    if (DBG) {
      console.debug('[lb-nav] init: app.route.discussion exists?', hasDiscussionRoute);
      console.debug('[lb-nav] init: typeof app.route =', typeof app.route);
      console.debug('[lb-nav] init: app.route keys =', Object.keys(app.route as any));
    }

    if (!hasDiscussionRoute) {
      if (DBG) console.warn('[lb-nav] app.route.discussion NOT found — hook aborted');
      return;
    }

    const origDiscussionRoute = (app.route as any).discussion.bind(app.route);
    if (DBG) console.debug('[lb-nav] hook installed, origDiscussionRoute =', origDiscussionRoute);

    (app.route as any).discussion = function (discussion: any, near?: number) {
      try {
        if (_suppressNear) {
          return origDiscussionRoute(discussion, near);
        }

        if (!near) {
          const id =
            typeof discussion?.id === 'function'
              ? discussion.id()
              : discussion?.id;

          if (id) {
            const stored = effectiveNearFromStore(String(id));

            if (DBG) {
              console.debug('[lb-nav] route.discussion called', {
                id,
                nearArg: near,
                stored,
                discussion,
              });
            }

            // v17 blog 兼容：需重定向到 blog 路由时生成 blogArticle.near
            if (stored && stored > 1 && shouldRedirectDiscussionToBlog(discussion)) {
              try {
                const slug =
                  typeof discussion.slug === 'function'
                    ? discussion.slug()
                    : discussion.slug;
                return app.route('blogArticle.near', { id: slug, near: stored });
              } catch {
                // blogArticle.near 路由不存在时 fallback
              }
            }

            if (stored) {
              near = stored;
            }
          }
        } else if (DBG) {
          console.debug('[lb-nav] route.discussion called with explicit near', { near });
        }
      } catch (e) {
        if (DBG) console.error('[lb-nav] hook error', e);
      }

      const result = origDiscussionRoute(discussion, near);
      if (DBG) console.debug('[lb-nav] final URL =', result, '(near =', near, ')');
      return result;
    };

    override(DiscussionListItem.prototype, 'view', function (original: any) {
      if ((this as any).attrs?.params?.q) {
        _suppressNear = true;
        try {
          return original();
        } finally {
          _suppressNear = false;
        }
      }
      return original();
    });

    // ---- 诊断：暴露到 window 供控制台手动检查 ----
    if (DBG) {
      (window as any).__lbDebug = {
        effectiveNearFromStore,
        dumpStore() {
          const all = app.store.all('discussions');
          return all.map((d: any) => ({
            id: d.id(),
            slug: d.slug?.(),
            lbReadingPosition: d.attribute('lbReadingPosition'),
            lastReadPostNumber: d.lastReadPostNumber?.() ?? d.attribute('lastReadPostNumber'),
          }));
        },
        testRoute(discussionId: string) {
          const d = app.store.getById('discussions', discussionId);
          if (!d) return 'discussion not in store';
          return {
            near: effectiveNearFromStore(discussionId),
            url: origDiscussionRoute(d),
            urlWithNear: origDiscussionRoute(d, effectiveNearFromStore(discussionId)),
          };
        },
      };
      console.debug('[lb-nav] window.__lbDebug ready — try __lbDebug.dumpStore() or __lbDebug.testRoute("123")');
    }
  });
}
