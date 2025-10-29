// js/src/forum/index.ts
import app from 'flarum/forum/app';
import { extend, override } from 'flarum/common/extend';
import DiscussionListItem from 'flarum/forum/components/DiscussionListItem';
import DiscussionPage from 'flarum/forum/components/DiscussionPage';
import PostStream from 'flarum/forum/components/PostStream';
import Link from 'flarum/common/components/Link';

// 模块化能力
import installReplyJumpInterceptor from './features/replyJumpInterceptor';
import installReadingShortcuts from './features/readingShortcuts';

// 安装“发帖后自动跳尾抑制”
installReplyJumpInterceptor();
// 安装“阅读快捷键：Shift+D/Shift+U/Shift+J/Shift+K”
installReadingShortcuts();

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
      if (typeof (a as any).number === 'number' && (a as any).number > 0) return (a as any).number;
      if (typeof (a as any).postNumber === 'number' && (a as any).postNumber > 0) return (a as any).postNumber;
      if (typeof (a as any).near === 'number' && (a as any).near > 0) return (a as any).near;
      if ((a as any).visible && typeof (a as any).visible.number === 'number' && (a as any).visible.number > 0) {
        return (a as any).visible.number as number;
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
    // ?near=数字
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
    // 搜索页（params.q）不改写，保留“最相关”体验；全局兜底会覆盖其它来源
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

  /** =================== 全局兜底优化 =================== */

  // —— 缓存：id → near
  const nearCache: Map<string, number> = new Map();

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
      if (!Number.isNaN(n) && n > 0) return n; // 包含 near=1（视为明确意图）
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

  async function resolveSpecialNear(id: string, kind: 'first' | 'last'): Promise<number> {
    if (kind === 'first') return 1;
    const d = app.store.getById('discussions', id);
    let last: number | null =
      d?.lastPostNumber ? d.lastPostNumber() :
      (d?.attribute ? d.attribute('lastPostNumber') : null);
    if (!last) {
      try {
        const res: any = await app.request({
          method: 'GET',
          url: `${app.forum.attribute('apiUrl')}/discussions/${id}`,
          params: { 'fields[discussions]': 'lastPostNumber' },
        });
        last = typeof res?.data?.attributes?.lastPostNumber === 'number'
          ? res.data.attributes.lastPostNumber
          : null;
      } catch {}
    }
    return (last && last > 0) ? last : 1;
  }

  function buildNearUrl(u: URL, near: number): string {
    const parts = u.pathname.split('/').filter(Boolean);
    const dIndex = parts.indexOf('d');
    const prefix = '/' + parts.slice(0, dIndex + 2).join('/');
    u.pathname = `${prefix}/${near}`;
    u.searchParams.delete('near');
    if (u.hash && /^#p\d+$/i.test(u.hash)) u.hash = '';
    return u.pathname + u.search + u.hash;
  }

  function nearFromStore(id: string): number | null {
    const d = app.store.getById('discussions', id);
    if (!d) return null;
    const lb = d.attribute && d.attribute('lbReadingPosition');
    const last =
      typeof d.lastReadPostNumber === 'function'
        ? d.lastReadPostNumber()
        : d.attribute && d.attribute('lastReadPostNumber');
    return typeof lb === 'number' && lb > 1
      ? lb
      : typeof last === 'number' && last > 1
      ? last
      : null;
  }

  async function nearFromApi(id: string): Promise<number | null> {
    try {
      const res: any = await app.request({
        method: 'GET',
        url: `${app.forum.attribute('apiUrl')}/discussions/${id}`,
        params: {
          'fields[discussions]': 'title,slug,lastReadPostNumber,lbReadingPosition',
        },
      });
      const attrs = res?.data?.attributes || {};
      const lb =
        typeof attrs.lbReadingPosition === 'number' ? attrs.lbReadingPosition : null;
      const last =
        typeof attrs.lastReadPostNumber === 'number'
          ? attrs.lastReadPostNumber
          : null;
      return (lb && lb > 1) ? lb : (last && last > 1 ? last : null);
    } catch {
      return null;
    }
  }

  /** —— 工具：从事件目标向上找 <a> */
  function findAnchor(target: EventTarget | null): HTMLAnchorElement | null {
    let el = target as HTMLElement | null;
    while (el && el !== document.body) {
      if (el instanceof HTMLAnchorElement) return el;
      el = el.parentElement;
    }
    return null;
  }

  /** 悬停：可重复刷新 near（为了左下角预览更准）；跳过 Scrubber */
  const hoverTimers = new WeakMap<EventTarget, number>();
  const SCRUBBER_SKIP = '.PostStreamScrubber, .Scrubber, .item-scrubber, .PostStream-scrubber, a.Scrubber-first, a.Scrubber-last';

  document.addEventListener(
    'mouseover',
    (e) => {
      const a = findAnchor(e.target);
      if (!a) return;
      if (a.matches('.Scrubber-first, .Scrubber-last') || a.closest(SCRUBBER_SKIP)) return;

      const t = window.setTimeout(async () => {
        try {
          // 只处理有明确 href 的锚点
          const hrefAttr = a.getAttribute('href');
          if (!hrefAttr || !hrefAttr.trim()) return;

          const u = new URL(a.href, window.location.href);
          if (!sameOrigin(u)) return;

          const explicit = hasExplicitNear(u);
          if (explicit) return; // 显式 near，无需改

          const id = parseDiscussionIdFromUrl(u);
          if (!id) return;

          let near = nearCache.get(id) ?? nearFromStore(id);
          if (!near) {
            near = await nearFromApi(id);
            if (near) nearCache.set(id, near);
          }
          if (near && near > 1) {
            const prev = a.dataset.lbRewrittenNear
              ? parseInt(a.dataset.lbRewrittenNear, 10)
              : null;
            if (prev !== near) {
              a.href = buildNearUrl(u, near);
              a.dataset.lbRewritten = '1';
              a.dataset.lbRewrittenNear = String(near);
            }
          }
        } catch {}
      }, 120);

      hoverTimers.set(a, t);
    },
    { passive: true }
  );

  document.addEventListener(
    'mouseout',
    (e) => {
      const a = findAnchor(e.target);
      if (!a) return;
      const t = hoverTimers.get(a);
      if (t) {
        window.clearTimeout(t);
        hoverTimers.delete(a);
      }
    },
    { passive: true }
  );

  /** 点击接管：跳过 Scrubber；尊重显式 near（含 first/last），其余按 lb>last 兜底 */
  document.addEventListener(
    'click',
    (e) => {
      const a = findAnchor(e.target);
      if (!a) return;

      // 1) Scrubber 及其“最早/最新”按钮：完全放行
      if (a.matches('.Scrubber-first, .Scrubber-last') || a.closest('.PostStreamScrubber, .Scrubber, .item-scrubber, .PostStream-scrubber')) {
        return;
      }

      // 2) 只处理具备 href 的同源讨论链接
      const hrefAttr = a.getAttribute('href');
      if (!hrefAttr || !hrefAttr.trim()) return; // 没有 href（空字符串）则放行

      let u: URL;
      try {
        u = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (!sameOrigin(u)) return;

      const id = parseDiscussionIdFromUrl(u);
      if (!id) return; // 只接管 /d/… 讨论链接

      // 阻断默认，避免容器覆盖 near
      e.preventDefault();
      // @ts-ignore
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();

      (async () => {
        // 3) 显式 near（含 1 / 'first' / 'last' / #reply） → 严格按显式执行
        const explicit = hasExplicitNear(u);
        if (explicit) {
          const near = typeof explicit === 'number'
            ? explicit
            : await resolveSpecialNear(id, explicit);
          const target = buildNearUrl(u, near);
          // @ts-ignore
          return m.route.set(target);
        }

        // 4) 否则按 lb > last 求 near（缓存 → 模型 → API）
        let near = nearCache.get(id) ?? nearFromStore(id);
        if (!near) {
          near = await nearFromApi(id);
          if (near) nearCache.set(id, near);
        }

        const target =
          near && near > 1 ? buildNearUrl(u, near) : u.pathname + u.search + u.hash;

        // 统一由我们导航，确保 near 不被覆盖
        // @ts-ignore
        return m.route.set(target);
      })().catch(() => {
        // 失败时用原始 href 兜底
        // @ts-ignore
        m.route.set(a.getAttribute('href')!);
      });
    },
    { capture: true }
  );

  /** 兜底补丁：任何地方调用 m.route.set('/d/:id') 时，如果我们有 near，就补成 '/:near' */
  // @ts-ignore
  const oldSet = m.route.set.bind(m.route);
  // @ts-ignore
  m.route.set = function (path: string, data?: any, options?: any) {
    try {
      const url = new URL(path, window.location.origin);
      const parts = url.pathname.split('/').filter(Boolean);
      const dIndex = parts.indexOf('d');
      if (dIndex !== -1 && parts.length > dIndex + 1) {
        const hasNearPath = parts.length > dIndex + 2 && /^\d+$/.test(parts[dIndex + 2]);
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
    } catch {}
    // @ts-ignore
    return oldSet(path, data, options);
  };
});
