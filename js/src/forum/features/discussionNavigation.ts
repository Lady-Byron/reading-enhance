// js/src/forum/features/discussionNavigation.ts
import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import DiscussionListItem from 'flarum/forum/components/DiscussionListItem';

// @ts-ignore
declare const flarum: any;

const DBG = true; // ← 诊断开关，定位完毕后改为 false

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
 * 从 store 读取有效阅读位置
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

/**
 * 递归遍历 VDOM，把匹配 /d/{slug} 的 href 改写为 /d/{slug}/{near}。
 * 只改还没有 near 的链接（末尾不是 /数字 的）。
 */
function patchDiscussionLinks(vnode: any, near: number, replacement?: string): void {
  if (!vnode || typeof vnode !== 'object') return;

  if (Array.isArray(vnode)) {
    for (let i = 0; i < vnode.length; i++) patchDiscussionLinks(vnode[i], near, replacement);
    return;
  }

  const href: string | undefined = vnode.attrs?.href;
  if (typeof href === 'string' && /^\/d\/[^/]+$/.test(href)) {
    vnode.attrs.href = replacement ?? href + '/' + near;
    if (DBG) console.debug('[lb-nav] patched list-item link', { from: href, to: vnode.attrs.href });
  }

  if (vnode.children) {
    if (Array.isArray(vnode.children)) {
      for (let i = 0; i < vnode.children.length; i++) patchDiscussionLinks(vnode.children[i], near, replacement);
    } else {
      patchDiscussionLinks(vnode.children, near, replacement);
    }
  }
}

let installed = false;

export default function installDiscussionNavigation() {
  if (installed) return;
  installed = true;

  app.initializers.add('lady-byron/reading-enhance-navigation', () => {
    // ================================================================
    //  Layer A: 钩住 app.route.discussion
    //  覆盖 positionChanged URL 重写 / Link 组件 / 以及其它经由此函数的调用
    // ================================================================
    if ((app.route as any).discussion) {
      const origDiscussionRoute = (app.route as any).discussion.bind(app.route);
      if (DBG) console.debug('[lb-nav] hooking app.route.discussion');

      (app.route as any).discussion = function (discussion: any, near?: number) {
        try {
          if (!near) {
            const id =
              typeof discussion?.id === 'function'
                ? discussion.id()
                : discussion?.id;

            if (id) {
              const stored = effectiveNearFromStore(String(id));

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
          }
        } catch {
          // 出错时保持原始行为
        }

        return origDiscussionRoute(discussion, near);
      };
    } else if (DBG) {
      console.warn('[lb-nav] app.route.discussion NOT found — Layer A skipped');
    }

    // ================================================================
    //  Layer B: 补丁 DiscussionListItem 列表项链接
    //  Flarum 1.8 的 DiscussionListItem 直接调用 app.route('discussion',{id:...})
    //  而非 app.route.discussion()，Layer A 覆盖不到这里。
    //  extend 在原 view() 之后执行，拿到已渲染的 VDOM，找到讨论链接并补上 /near。
    // ================================================================
    extend(DiscussionListItem.prototype, 'view', function (vdom: any) {
      // 搜索结果不改写，保持"最相关"语义
      if ((this as any).attrs?.params?.q) return;

      const discussion = (this as any).attrs?.discussion;
      if (!discussion) return;

      const id = typeof discussion.id === 'function' ? discussion.id() : discussion.id;
      if (!id) return;

      const near = effectiveNearFromStore(String(id));
      if (!near || near <= 1) return;

      // Blog 兼容：如需重定向到 blog 路由则替换整个 URL
      if (shouldRedirectDiscussionToBlog(discussion)) {
        try {
          const slug = typeof discussion.slug === 'function' ? discussion.slug() : discussion.slug;
          const blogUrl = app.route('blogArticle.near', { id: slug, near });
          patchDiscussionLinks(vdom, near, blogUrl);
          return;
        } catch {
          // fallback 到普通讨论链接补丁
        }
      }

      patchDiscussionLinks(vdom, near);
    });

    // ---- 诊断工具 ----
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
      };
      console.debug('[lb-nav] __lbDebug ready');
    }
  });
}
