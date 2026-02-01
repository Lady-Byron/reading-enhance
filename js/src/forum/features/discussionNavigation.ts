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
    /**
     * 钩住 app.route.discussion —— 所有讨论 URL 生成的唯一收口点。
     * DiscussionListItem、Link 组件、m.route.set 等均通过此函数生成讨论 URL，
     * 因此只需在此处注入 near 参数即可覆盖全部场景。
     *
     * 原 4 层补丁（DiscussionListItem.view / Link.view / app.route.discussion / m.route.set）
     * 精简为此单一钩子 + 搜索页抑制，消除 #4 死代码、#9 性能问题、#15 过度补丁。
     */
    if (!(app.route as any).discussion) return;

    const origDiscussionRoute = (app.route as any).discussion.bind(app.route);

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
        }
      } catch {
        // 出错时保持原始行为
      }

      return origDiscussionRoute(discussion, near);
    };

    /**
     * 搜索页抑制：搜索结果的讨论链接应指向"最相关"帖子，不注入阅读位置。
     * 通过 override 在搜索列表渲染期间设置抑制标志。
     */
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
  });
}
