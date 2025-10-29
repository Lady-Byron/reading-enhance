// js/src/forum/index.ts
import app from 'flarum/forum/app';
import { extend, override } from 'flarum/common/extend';
import DiscussionListItem from 'flarum/forum/components/DiscussionListItem';
import DiscussionPage from 'flarum/forum/components/DiscussionPage';
import PostStream from 'flarum/forum/components/PostStream';
import Link from 'flarum/common/components/Link';

/** ---- v17 blog 路由判定（与你现有实现一致） ---- */
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
      // number / postNumber / near / visible.number
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
    const parts = url.pathname.split('/').filter(Boolean);
    const dIndex = parts.indexOf('d');
    if (dIndex !== -1 && parts.length > dIndex + 2) {
      const maybeNear = parseInt(parts[dIndex + 2], 10);
      if (!Number.isNaN(maybeNear) && maybeNear > 0) return maybeNear;
    }
    const qNear = parseInt(url.searchParams.get('near') || '', 10);
    if (!Number.isNaN(qNear) && qNear > 0) return qNear;
  } catch {}
  return null;
}

/** 顶部相交（部分可见即可），作为最后退路 */
function extractTopPartiallyVisible(): number | null {
  const items = document.querySelectorAll<HTMLElement>('.PostStream-item[data-number]');
  const viewportTop = 4;
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

  /** =================== 全局兜底优化（悬停可重复、点击阻止默认+同步导航） =================== */

  // —— 缓存：id → near
  const nearCache: Map<string, number> = new Map();

  // 从 store 或 API 获取 near：优先 lbReadingPosition，再用 lastReadPostNumber
  async function resolveNearForId(id: string): Promise<number | null> {
    if (!app.session.user) return null;

    if (nearCache.has(id)) return nearCache.get(id)!;

    const d = app.store.getById('discussions', id);
    if (d) {
      const lb = d.attribute && d.attribute('lbReadingPosition');
      const last =
        typeof d.lastReadPostNumber === 'function'
          ? d.lastReadPostNumber()
          : d.attribute && d.attribute('lastReadPostNumber');
      const n = (typeof lb === 'number' && lb > 1) ? lb : (typeof last === 'number' && last > 1 ? last : null);
      if (n) {
        nearCache.set(id, n);
        return n;
      }
    }

    try {
      const res: any = await app.request({
        method: 'GET',
        url: `${app.forum.attribute('apiUrl')}/discussions/${id}`,
        params: {
          // 显式带上 lbReadingPosition 与 lastReadPostNumber
          'fields[discussions]': 'title,slug,lastReadPostNumber,lbReadingPosition',
        },
      });

      const attrs = res?.data?.attributes || {};
      const lb = typeof attrs.lbReadingPosition === 'number' ? attrs.lbReadingPosition : null;
      const last = typeof attrs.lastReadPostNumber === 'number' ? attrs.lastReadPostNumber : null;

      const n = (lb && lb > 1) ? lb : (last && last > 1 ? last : null);
      if (n) {
        nearCache.set(id, n);
        return n;
      }
    } catch {}

    return null;
  }

  function isSameOrigin(u: URL): boolean {
    try {
      const base = new URL(app.forum.attribute('baseUrl'));
      return u.origin === base.origin;
    } catch { return false; }
  }

  function hasExplicitNear(u: URL): boolean {
    const parts = u.pathname.split('/').filter(Boolean);
    const dIndex = parts.indexOf('d');
    if (dIndex !== -1 && parts.length > dIndex + 2) {
      const maybeNear = parseInt(parts[dIndex + 2], 10);
      if (!Number.isNaN(maybeNear) && maybeNear > 0) return true;
    }
    const qNear = parseInt(u.searchParams.get('near') || '', 10);
    if (!Number.isNaN(qNear) && qNear > 0) return true;
    if (u.hash && /^#p\d+$/i.test(u.hash)) return true;
    return false;
  }

  function parseDiscussionIdFromUrl(u: URL): string | null {
    const parts = u.pathname.split('/').filter(Boolean);
    const dIndex = parts.indexOf('d');
    if (dIndex === -1 || parts.length <= dIndex + 1) return null;
    const idPart = parts[dIndex + 1];
    const match = /^(\d+)/.exec(idPart);
    return match ? match[1] : null;
  }

  function rewriteHrefWithNear(u: URL, near: number): void {
    const parts = u.pathname.split('/').filter(Boolean);
    const dIndex = parts.indexOf('d');
    if (dIndex === -1 || parts.length <= dIndex + 1) return;
    const prefix = '/' + parts.slice(0, dIndex + 2).join('/');
    u.pathname = `${prefix}/${near}`;
    u.searchParams.delete('near');
    if (u.hash && /^#p\d+$/i.test(u.hash)) u.hash = '';
  }

  // 悬停：可重复改写（若 near 变化则刷新 href）
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

    const t = window.setTimeout(async () => {
      try {
        const u = new URL(a.href, window.location.href);
        if (!isSameOrigin(u) || hasExplicitNear(u)) return;

        const id = parseDiscussionIdFromUrl(u);
        if (!id) return;

        const near = await resolveNearForId(id);
        if (near && near > 1) {
          const prev = a.dataset.lbRewrittenNear ? parseInt(a.dataset.lbRewrittenNear, 10) : null;
          // 只有在 near 发生变化时才重写，避免频繁抖动
          if (prev !== near) {
            rewriteHrefWithNear(u, near);
            a.href = u.toString();
            a.dataset.lbRewritten = '1';
            a.dataset.lbRewrittenNear = String(near);
          }
        }
      } catch {}
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

  // 点击：阻止默认 + 同步决定最终 near 然后导航
  document.addEventListener('click', (e) => {
    const a = findAnchor(e.target);
    if (!a) return;

    let u: URL;
    try { u = new URL(a.href, window.location.href); } catch { return; }

    if (!isSameOrigin(u) || hasExplicitNear(u)) return;

    const id = parseDiscussionIdFromUrl(u);
    if (!id) return;

    // 阻止默认，避免 Mithril 先用旧 href 导航
    e.preventDefault();

    // 先用“眼前可用”的 near（缓存/模型），保证快速跳转；若没有再等 API
    (async () => {
      let near: number | null = nearCache.get(id) ?? null;

      if (!near) {
        const d = app.store.getById('discussions', id);
        if (d) {
          const lb = d.attribute && d.attribute('lbReadingPosition');
          const last =
            typeof d.lastReadPostNumber === 'function'
              ? d.lastReadPostNumber()
              : d.attribute && d.attribute('lastReadPostNumber');
          near = (typeof lb === 'number' && lb > 1) ? lb : (typeof last === 'number' && last > 1 ? last : null);
        }
      }

      if (!near) near = await resolveNearForId(id);

      if (near && near > 1) {
        rewriteHrefWithNear(u, near);
        // 用 Mithril 导航，保持 SPA
        // @ts-ignore
        return m.route.set(u.pathname + u.search + u.hash);
      }

      // 没拿到 near：退回原 href
      // @ts-ignore
      return m.route.set(a.getAttribute('href')!);
    })().catch(() => {
      // 出错时做最保守的导航回退
      // @ts-ignore
      m.route.set(a.getAttribute('href')!);
    });
  }, { capture: true });
});
