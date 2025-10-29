// js/src/forum/index.ts
import app from 'flarum/forum/app';
import { extend, override } from 'flarum/common/extend';
import DiscussionListItem from 'flarum/forum/components/DiscussionListItem';
import DiscussionPage from 'flarum/forum/components/DiscussionPage';
import PostStream from 'flarum/forum/components/PostStream';
import Link from 'flarum/common/components/Link';

/** ---- v17 blog 路由判定（与你现有实现一致，便于复用） ---- */
function shouldRedirectDiscussionToBlog(discussion: any): boolean {
  // @ts-ignore
  if (!('v17development-blog' in flarum.extensions)) return false;

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

/** ============ 与原生一致的“当前位置 → 楼层号”提取工具 ============ */
function derivePostNumberFromPositionChangeArgs(args: any[]): number | null {
  for (const a of args) {
    if (a == null) continue;

    if (typeof a === 'number') {
      if (a > 0) return a;
    } else if (typeof a === 'object') {
      // 常见字段：number / postNumber / near / visible.number
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (typeof a.number === 'number' && a.number > 0) return a.number;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (typeof a.postNumber === 'number' && a.postNumber > 0) return a.postNumber;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (typeof a.near === 'number' && a.near > 0) return a.near;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (a.visible && typeof a.visible.number === 'number' && a.visible.number > 0) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        return a.visible.number as number;
      }
    }
  }
  return null;
}

function extractNearFromUrl(): number | null {
  try {
    const url = new URL(window.location.href);
    // /d/:id/:near
    const parts = url.pathname.split('/').filter(Boolean);
    const dIndex = parts.indexOf('d');
    if (dIndex !== -1 && parts.length > dIndex + 2) {
      const maybeNear = parseInt(parts[dIndex + 2], 10);
      if (!Number.isNaN(maybeNear) && maybeNear > 0) return maybeNear;
    }
    // ?near=
    const qNear = parseInt(url.searchParams.get('near') || '', 10);
    if (!Number.isNaN(qNear) && qNear > 0) return qNear;
  } catch {
    /* noop */
  }
  return null;
}

/** 顶部相交（部分可见即可），作为最后退路 */
function extractTopPartiallyVisible(): number | null {
  const items = document.querySelectorAll<HTMLElement>('.PostStream-item[data-number]');
  const viewportTop = 4; // 轻容忍
  for (const el of Array.from(items)) {
    const rect = el.getBoundingClientRect();
    if (rect.top <= viewportTop && rect.bottom > viewportTop) {
      const n = parseInt(el.dataset.number || '', 10);
      if (n > 0) return n;
    }
  }
  for (const el of Array.from(items)) {
    const rect = el.getBoundingClientRect();
    if (rect.top >= viewportTop && rect.top < (window.innerHeight || 0)) {
      const n = parseInt(el.dataset.number || '', 10);
      if (n > 0) return n;
    }
  }
  return null;
}

/** 写库（lb_read_post_number；静默失败即可） */
function savePosition(discussionId: string, postNumber: number) {
  return app
    .request({
      method: 'POST',
      url: `${app.forum.attribute('apiUrl')}/ladybyron/reading-position`,
      body: { discussionId, postNumber },
    })
    .catch(() => {});
}

/** 200ms 轻节流 + 去重（双向允许） */
const DEBOUNCE_MS = 200;
const pendingTimerByDiscussion: Record<string, number> = Object.create(null);
const pendingCandidateByDiscussion: Record<string, number> = Object.create(null);
const lastCommittedByDiscussion: Record<string, number> = Object.create(null);

function scheduleSaveBidirectional(discussion: any, candidate: number) {
  const id: string = discussion.id();
  if (pendingCandidateByDiscussion[id] === candidate) return;

  pendingCandidateByDiscussion[id] = candidate;

  if (pendingTimerByDiscussion[id]) window.clearTimeout(pendingTimerByDiscussion[id]);

  pendingTimerByDiscussion[id] = window.setTimeout(() => {
    const toSend = pendingCandidateByDiscussion[id];
    if (typeof toSend !== 'number' || toSend <= 0) return;

    const current = discussion.attribute('lbReadingPosition') ?? 0;
    const lastCommitted = lastCommittedByDiscussion[id] ?? current;
    if (toSend === current || toSend === lastCommitted) return;

    savePosition(id, toSend).then(() => {
      lastCommittedByDiscussion[id] = toSend;
      if (discussion.attribute('lbReadingPosition') !== toSend) {
        discussion.pushAttributes({ lbReadingPosition: toSend });
      }
    });
  }, DEBOUNCE_MS);
}

/** =================== 原插件：列表项改写（不处理搜索页） =================== */
app.initializers.add('lady-byron/reading-enhance', () => {
  extend(DiscussionListItem.prototype, 'view', function (vdom: any) {
    // 按你的既有逻辑：搜索页（params.q）不改写，保留“最相关”体验
    if ((this as any).attrs?.params?.q) return;

    const discussion = (this as any).attrs?.discussion;
    if (!discussion) return;

    const recorded: number | null = discussion.attribute('lbReadingPosition') ?? null;
    if (!recorded || recorded <= 1) return; // 无记录或仅 1 楼无需 near

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

        sub.attrs.href = href;
      });
    });
  });

  /** ========== 原插件：阅读页实时写库（双向，200ms 合并） ========== */
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

          let n = derivePostNumberFromPositionChangeArgs(cbArgs);
          if (!n) n = extractNearFromUrl();
          if (!n) n = extractTopPartiallyVisible();

          if (n && typeof n === 'number' && n > 0) {
            scheduleSaveBidirectional(discussion, n);
          }
        };
      }
    };

    inject(vdom);
    return vdom;
  });

  /** =================== 全局兜底优化（最后一跳改写） =================== */

  // —— 缓存：id → near
  const nearCache: Map<string, number> = new Map();

  // 从 store 或 API 获取 near：优先 lbReadingPosition，再用 lastReadPostNumber
  async function resolveNearForId(id: string): Promise<number | null> {
    // 仅登录用户有意义
    if (!app.session.user) return null;

    // 1) 缓存命中
    if (nearCache.has(id)) return nearCache.get(id)!;

    // 2) store 命中（零请求）
    const d = app.store.getById('discussions', id);
    if (d) {
      const lb = d.attribute('lbReadingPosition');
      const last = typeof d.lastReadPostNumber === 'function' ? d.lastReadPostNumber() : d.attribute?.('lastReadPostNumber');
      const n = (typeof lb === 'number' && lb > 1) ? lb : (typeof last === 'number' && last > 1 ? last : null);
      if (n) {
        nearCache.set(id, n);
        return n;
      }
    }

    // 3) 单次 API 预取（悬停/首击时触发，尽量少用）
    try {
      const res: any = await app.request({
        method: 'GET',
        url: `${app.forum.attribute('apiUrl')}/discussions/${id}`,
        params: {
          // 显式字段，防止被别的扩展裁剪
          'fields[discussions]': 'title,slug,lastReadPostNumber,canReply,commentCount',
        },
      });

      const data = res?.data;
      if (!data) return null;

      const attrs = data.attributes || {};
      // 你的 lbReadingPosition 已通过 Serializer 输出到 attributes
      const lb = typeof attrs.lbReadingPosition === 'number' ? attrs.lbReadingPosition : null;
      const last = typeof attrs.lastReadPostNumber === 'number' ? attrs.lastReadPostNumber : null;

      const n = (lb && lb > 1) ? lb : (last && last > 1 ? last : null);
      if (n) {
        nearCache.set(id, n);
        return n;
      }
    } catch {
      /* ignore */
    }

    return null;
  }

  // 是否内部同源
  function isSameOrigin(u: URL): boolean {
    try {
      const base = new URL(app.forum.attribute('baseUrl'));
      return u.origin === base.origin;
    } catch {
      return false;
    }
  }

  // 是否显式 near（路径 /d/:id/:near 或 ?near=，或 #pNNN）
  function hasExplicitNear(u: URL): boolean {
    // /d/:id/:near
    const parts = u.pathname.split('/').filter(Boolean);
    const dIndex = parts.indexOf('d');
    if (dIndex !== -1 && parts.length > dIndex + 2) {
      const maybeNear = parseInt(parts[dIndex + 2], 10);
      if (!Number.isNaN(maybeNear) && maybeNear > 0) return true;
    }
    // ?near=
    const qNear = parseInt(u.searchParams.get('near') || '', 10);
    if (!Number.isNaN(qNear) && qNear > 0) return true;
    // #pNNN
    if (u.hash && /^#p\d+$/i.test(u.hash)) return true;
    return false;
  }

  // 是否 /d/:id（或 /d/:id-slug）形式的讨论链接（未判断 blog；blog 另行处理）
  function parseDiscussionIdFromUrl(u: URL): string | null {
    const parts = u.pathname.split('/').filter(Boolean);
    const dIndex = parts.indexOf('d');
    if (dIndex === -1 || parts.length <= dIndex + 1) return null;

    // 取 id（可能是 "182" 或 "182-xxx"）
    const idPart = parts[dIndex + 1];
    const match = /^(\d+)/.exec(idPart);
    return match ? match[1] : null;
  }

  // 将 href 改成带 near（尽量保留原 slug；无 slug 则用 /d/:id/:near）
  function rewriteHrefWithNear(u: URL, near: number): void {
    const parts = u.pathname.split('/').filter(Boolean);
    const dIndex = parts.indexOf('d');
    if (dIndex === -1 || parts.length <= dIndex + 1) return;

    // 规范化为 /d/:id(-slug)?/:near
    const idSlug = parts[dIndex + 1];
    const prefix = '/' + parts.slice(0, dIndex + 2).join('/');
    u.pathname = `${prefix}/${near}`;

    // 清掉 query 的 near（以路径 near 为准）
    u.searchParams.delete('near');
    // 清除锚点形式
    if (u.hash && /^#p\d+$/i.test(u.hash)) u.hash = '';
  }

  // v17 Blog 的 near：保留文章路由，添加 ?near=near
  function rewriteBlogHrefWithNear(u: URL, near: number): void {
    // 假设 blog 文章已是 /blog/xxxx 结构，直接加 ?near=
    u.searchParams.set('near', String(near));
  }

  function isBlogArticleUrl(u: URL): boolean {
    // 仅当站点装了 blog 时才判断
    // @ts-ignore
    if (!('v17development-blog' in flarum.extensions)) return false;
    // 粗判：路径中包含 /blog/
    return /\/blog\//.test(u.pathname);
  }

  // 尝试改写某个 <a>：返回是否改写
  async function maybeRewriteAnchor(el: HTMLAnchorElement, reason: 'hover' | 'click'): Promise<boolean> {
    // 已处理过则跳过
    if (el.dataset.lbRewritten === '1') return false;

    let u: URL;
    try {
      u = new URL(el.href, window.location.href);
    } catch {
      return false;
    }

    if (!isSameOrigin(u)) return false;        // 外链放行
    if (hasExplicitNear(u)) return false;      // 显式 near/锚点放行

    const isBlog = isBlogArticleUrl(u);
    let id: string | null = null;

    if (!isBlog) {
      id = parseDiscussionIdFromUrl(u);
      if (!id) return false; // 非 /d/ 链接放行
    }

    // 解析 near：先 store，后 API
    const near = isBlog
      ? null // blog 情况下，不从 URL 提 id，这里只做“如果稍后解析到模型再说”；点击时候仍会正常进入文章页
      : await resolveNearForId(id!);

    // blog：只有在点击/悬停时能拿到模型或提前缓存 near 才改写；否则放行
    if (isBlog) {
      // 尝试从 store 猜测 slug 对应的讨论（多数 blog 扩展会把讨论预装到 store；拿不到就放行）
      // 这里我们不强求，避免误判；若将来需要，可在 Blog 组件层做专门适配
      return false;
    }

    if (near && near > 1) {
      rewriteHrefWithNear(u, near);
      el.href = u.toString();
      el.dataset.lbRewritten = '1';
      return true;
    }

    return false;
  }

  // 事件代理：悬停时预取（120ms 延迟），点击前兜底改写
  const hoverTimers = new WeakMap<EventTarget, number>();

  function findAnchor(target: EventTarget | null): HTMLAnchorElement | null {
    let el = target as HTMLElement | null;
    while (el && el !== document.body) {
      if (el instanceof HTMLAnchorElement) return el;
      el = el.parentElement;
    }
    return null;
  }

  document.addEventListener('mouseover', (e) => {
    const a = findAnchor(e.target);
    if (!a) return;
    if (hoverTimers.has(a)) return;

    const t = window.setTimeout(() => {
      hoverTimers.delete(a);
      void maybeRewriteAnchor(a, 'hover');
    }, 120);

    hoverTimers.set(a, t);
  }, { passive: true });

  document.addEventListener('mouseout', (e) => {
    const a = findAnchor(e.target);
    if (!a) return;
    const t = hoverTimers.get(a);
    if (t) {
      window.clearTimeout(t);
      hoverTimers.delete(a);
    }
  }, { passive: true });

  document.addEventListener('click', (e) => {
    const a = findAnchor(e.target);
    if (!a) return;

    // 若还没改写，尝试最后一刻改写（同步）
    // 注意：不阻止默认行为；只在拿到 near 时更新 href 即可
    void maybeRewriteAnchor(a, 'click');
  }, { capture: true });
});
