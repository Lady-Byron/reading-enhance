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
    // 确保同源且符合 /d/123 格式
    if (u.origin !== window.location.origin) return null;
    const match = u.pathname.match(/\/d\/(\d+)/);
    return match ? match[1] : null;
  } catch { return null; }
}

// 判断是否包含显式楼层意图 (如 /d/123/5 或 ?near=5)
// 如果包含，插件应放行，尊重用户意图
function hasExplicitNear(urlStr: string): boolean {
  try {
    const u = new URL(urlStr, window.location.origin);
    // 路径层级 > 3 说明带了楼层 (e.g. /d/123/5)
    if (u.pathname.split('/').filter(Boolean).length > 2) return true;
    // 查询参数 explicit
    if (u.searchParams.has('near')) return true;
    // 锚点 explicit (e.g. #p123, #reply)
    if (u.hash) return true;
  } catch {}
  return false;
}

// 兼容 v17-blog 插件的路由重定向判定 (保留旧逻辑)
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

// 正在进行的请求池 (避免重复请求)
const pendingRequests = new Map<string, Promise<void>>();

async function ensurePosition(id: string): Promise<void> {
  // 1. 检查 Store (列表页通常已预加载)
  const d = app.store.getById('discussions', id);
  // 如果 Store 里有对象，且 lbReadingPosition 字段不为 undefined，说明数据已同步
  if (d && d.attribute('lbReadingPosition') !== undefined) return;

  // 2. 检查是否正在请求中
  if (pendingRequests.has(id)) return pendingRequests.get(id);

  // 3. 发起静默请求
  const promise = app.request<any>({
    method: 'GET',
    url: `${app.forum.attribute('apiUrl')}/discussions/${id}`,
    // 同时请求插件记录和原生记录，确保兜底逻辑可用
    params: { 'fields[discussions]': 'lbReadingPosition,lastReadPostNumber' },
    background: true, // 关键：不触发 Mithril 全局重绘
  }).then((res) => {
    app.store.pushPayload(res);
  }).finally(() => {
    pendingRequests.delete(id);
  });

  pendingRequests.set(id, promise);
  return promise;
}

// 核心决策逻辑：决定跳哪里
function resolveTarget(id: string): number | null {
  const d = app.store.getById('discussions', id);
  if (!d) return null;

  // 优先级 1: 插件记录 (lbReadingPosition)
  const lb = d.attribute('lbReadingPosition');
  if (typeof lb === 'number' && lb > 1) return lb;

  // 优先级 2: Flarum 原生记录 (lastReadPostNumber)
  const last = d.lastReadPostNumber();
  if (typeof last === 'number' && last > 1) return last;

  // 优先级 3: 无记录 (跳 1 楼)
  return null;
}

/**
 * ===========================================================================
 * Main Install Function
 * ===========================================================================
 */
export default function installSmartJump() {
  
  // 1. 视口预加载器 (Viewport Prefetcher)
  // -----------------------------------------------------
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const a = entry.target as HTMLAnchorElement;
        const id = getDiscussionId(a.href);
        if (id) ensurePosition(id); // 滑入视口即请求
        observer.unobserve(a);      // 仅触发一次
      }
    });
  }, { rootMargin: '100px' }); // 提前 100px 预热

  // 挂载扫描逻辑：每当页面更新时，扫描新出现的帖子链接
  const scanLinks = () => {
    document.querySelectorAll('a[href^="/d/"]:not([data-lb-obs])').forEach((el) => {
      // 排除 Scrubber 等非内容链接
      if (el.closest('.PostStreamScrubber, .Scrubber')) return;
      
      observer.observe(el);
      el.setAttribute('data-lb-obs', '1');
    });
  };

  extend(app, 'mount', scanLinks);
  extend(app, 'update', scanLinks); // 每次 Mithril 重绘后扫描

  // 2. 列表视图重写 (Visual Rewrite for Discussion List)
  // -----------------------------------------------------
  // 仅针对已加载数据的列表项修改 href，方便“右键新标签页打开”
  extend(DiscussionListItem.prototype, 'view', function (vdom: any) {
    if (this.attrs?.params?.q) return; // 不处理搜索页
    const discussion = this.attrs?.discussion;
    if (!discussion) return;

    // 使用决策逻辑获取楼层
    const targetNear = resolveTarget(discussion.id());
    if (!targetNear) return;

    // 遍历 vdom 修改链接
    // 注意：这里仅做视觉修正，实际点击行为由下方的拦截器接管
    const injectHref = (node: any) => {
        if (!node) return;
        if (Array.isArray(node)) return node.forEach(injectHref);
        if (node.tag === Link && node.attrs?.href) {
             // 检查是否是主链接
             if (node.attrs.className && node.attrs.className.includes('DiscussionListItem-count')) return; // 不改回复计数球
             
             // 生成目标链接
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

  // 3. 点击拦截器 (Click Interceptor with UI)
  // -----------------------------------------------------
  document.addEventListener('click', async (e) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;

    // 排除 Scrubber
    if (a.closest('.PostStreamScrubber, .Scrubber')) return;

    const id = getDiscussionId(a.href);
    if (!id) return; // 不是帖子链接

    // 检查显式意图，如果存在则放行
    if (hasExplicitNear(a.href)) return;

    // --- 开始拦截 ---
    e.preventDefault();
    e.stopPropagation();

    // 添加加载动画 UI
    a.classList.add('lb-loading-jump');

    try {
      // 强制等待数据 (如果预热已完成，此处为瞬时)
      await ensurePosition(id);

      const d = app.store.getById('discussions', id);
      const target = resolveTarget(id);

      a.classList.remove('lb-loading-jump');

      if (target && d) {
        // 执行智能跳转
        // 兼容 Blog 逻辑
        if (shouldRedirectDiscussionToBlog(d)) {
             m.route.set(app.route('blogArticle.near', { id: d.slug(), near: target }));
        } else {
             m.route.set(app.route.discussion(d, target));
        }
      } else {
        // 兜底：未读过，跳 1 楼 (解析原始 URL 路径)
        const u = new URL(a.href, window.location.origin);
        m.route.set(u.pathname + u.search + u.hash);
      }
    } catch (err) {
      // 异常兜底：移除动画，尝试普通跳转
      a.classList.remove('lb-loading-jump');
      const href = a.getAttribute('href');
      if (href) m.route.set(href);
    }
  }, { capture: true }); // 使用捕获阶段，确保优于 Flarum 默认 Link 组件执行
}
