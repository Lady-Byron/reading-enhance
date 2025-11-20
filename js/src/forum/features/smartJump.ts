import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import DiscussionListItem from 'flarum/forum/components/DiscussionListItem';
import Link from 'flarum/common/components/Link';

/**
 * ===========================================================================
 * Helper Functions: 工具函数与逻辑判断
 * ===========================================================================
 */

// 解析 URL 中的 ID
function getDiscussionId(urlStr: string): string | null {
  try {
    const u = new URL(urlStr, window.location.origin);
    if (u.origin !== window.location.origin) return null;
    const match = u.pathname.match(/\/d\/(\d+)/);
    return match ? match[1] : null;
  } catch { return null; }
}

// 判断是否包含显式楼层意图
function hasExplicitNear(urlStr: string): boolean {
  try {
    const u = new URL(urlStr, window.location.origin);
    if (u.pathname.split('/').filter(Boolean).length > 2) return true;
    if (u.searchParams.has('near')) return true;
    if (u.hash) return true;
  } catch {}
  return false;
}

// 兼容 v17-blog 插件
function shouldRedirectDiscussionToBlog(discussion: any): boolean {
  // @ts-ignore
  if (!('v17development-blog' in flarum.extensions)) return false;
  const redirects = app.forum.attribute('blogRedirectsEnabled');
  const discussionRedirectEnabled = redirects === 'both' || redirects === 'discussions_only';
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

/**
 * ===========================================================================
 * Data Layer: 数据预热与获取
 * ===========================================================================
 */

const pendingRequests = new Map<string, Promise<void>>();

async function ensurePosition(id: string): Promise<void> {
  // 1. 检查 Store
  const d = app.store.getById('discussions', id);
  // 只有当 slug 存在（确保能生成路由）且 readingPosition 存在时，才算命中
  if (d && d.slug() && d.attribute('lbReadingPosition') !== undefined) return;

  // 2. 检查是否正在请求中
  if (pendingRequests.has(id)) return pendingRequests.get(id);

  // 3. 发起静默请求
  const promise = app.request<any>({
    method: 'GET',
    url: `${app.forum.attribute('apiUrl')}/discussions/${id}`,
    // 【修复点】必须请求 slug，否则新加载的帖子对象无法生成路由！
    // 同时请求 title 虽然不是必须的，但有助于完善 store 数据
    params: { 'fields[discussions]': 'slug,title,lbReadingPosition,lastReadPostNumber' },
    background: true,
  }).then((res) => {
    app.store.pushPayload(res);
  }).finally(() => {
    pendingRequests.delete(id);
  });

  pendingRequests.set(id, promise);
  return promise;
}

function resolveTarget(id: string): number | null {
  const d = app.store.getById('discussions', id);
  if (!d) return null;

  const lb = d.attribute('lbReadingPosition');
  if (typeof lb === 'number' && lb > 1) return lb;

  const last = d.lastReadPostNumber();
  if (typeof last === 'number' && last > 1) return last;

  return null;
}

/**
 * ===========================================================================
 * Main Install Function
 * ===========================================================================
 */
export default function installSmartJump() {
  
  // 1. 视口预加载器
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const a = entry.target as HTMLAnchorElement;
        const id = getDiscussionId(a.href);
        if (id) ensurePosition(id);
        observer.unobserve(a);
      }
    });
  }, { rootMargin: '100px' });

  const scanLinks = () => {
    document.querySelectorAll('a[href^="/d/"]:not([data-lb-obs])').forEach((el) => {
      if (el.closest('.PostStreamScrubber, .Scrubber')) return;
      observer.observe(el);
      el.setAttribute('data-lb-obs', '1');
    });
  };

  extend(app, 'mount', scanLinks);
  extend(app, 'update', scanLinks);

  // 2. 列表视图重写 (Visual Rewrite)
  extend(DiscussionListItem.prototype, 'view', function (vdom: any) {
    if (this.attrs?.params?.q) return;
    const discussion = this.attrs?.discussion;
    if (!discussion) return;

    const targetNear = resolveTarget(discussion.id());
    if (!targetNear) return;

    const injectHref = (node: any) => {
        if (!node) return;
        if (Array.isArray(node)) return node.forEach(injectHref);
        if (node.tag === Link && node.attrs?.href) {
             if (node.attrs.className && node.attrs.className.includes('DiscussionListItem-count')) return;
             
             let newHref = '';
             if (shouldRedirectDiscussionToBlog(discussion)) {
                 newHref = app.route('blogArticle.near', { id: discussion.slug(), near: targetNear });
             } else {
                 newHref = app.route.discussion(discussion, targetNear);
             }
             node.attrs.href = newHref;
        }
        if (node.children) injectHref(node.children);
    };
    injectHref(vdom);
  });

  // 3. 点击拦截器 (Click Interceptor)
  document.addEventListener('click', async (e) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    if (a.closest('.PostStreamScrubber, .Scrubber')) return;

    const id = getDiscussionId(a.href);
    if (!id) return;

    if (hasExplicitNear(a.href)) return;

    e.preventDefault();
    e.stopPropagation();

    a.classList.add('lb-loading-jump');

    try {
      await ensurePosition(id);

      const d = app.store.getById('discussions', id);
      const target = resolveTarget(id);

      a.classList.remove('lb-loading-jump');

      if (target && d && d.slug()) { // 确保有 slug 才能跳
        if (shouldRedirectDiscussionToBlog(d)) {
             m.route.set(app.route('blogArticle.near', { id: d.slug(), near: target }));
        } else {
             m.route.set(app.route.discussion(d, target));
        }
      } else if (target && d) {
        // 【安全兜底】如果有 target 但没 slug (极罕见)，手动拼 ID 链接
        // 这能防止 undefined 错误
        m.route.set(`/d/${id}/${target}`);
      } else {
        // 兜底：未读过，跳原始链接
        const u = new URL(a.href, window.location.origin);
        m.route.set(u.pathname + u.search + u.hash);
      }
    } catch (err) {
      console.error(err);
      a.classList.remove('lb-loading-jump');
      const href = a.getAttribute('href');
      if (href) m.route.set(href);
    }
  }, { capture: true });
}
