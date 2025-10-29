// js/src/forum/index.ts
import app from 'flarum/forum/app';
import { extend, override } from 'flarum/common/extend';
import DiscussionListItem from 'flarum/forum/components/DiscussionListItem';
import DiscussionPage from 'flarum/forum/components/DiscussionPage';
import PostStream from 'flarum/forum/components/PostStream';
import Link from 'flarum/common/components/Link';

/** ---- v17 blog 路由判定（简化版，与原实现一致） ---- */
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
/** ---------------------------------------------------------- */

/** 从 PostStream 的 onPositionChange 回调参数中尽量还原“当前可见楼层号” */
function derivePostNumberFromPositionChangeArgs(args: any[]): number | null {
  // 兼容若干可能的签名： (index, number) / ({ number }) / ({ postNumber }) / ({ near }) …
  for (const a of args) {
    if (a == null) continue;

    if (typeof a === 'number') {
      // 注意：有的实现第一个可能是 index，但通常会出现“一个明显大于 0 的 number”
      if (a > 0) return a;
      continue;
    }

    if (typeof a === 'object') {
      // 常见字段
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (typeof a.number === 'number' && a.number > 0) return a.number;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (typeof a.postNumber === 'number' && a.postNumber > 0) return a.postNumber;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (typeof a.near === 'number' && a.near > 0) return a.near;
      // 某些包装对象 visible: { number }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (a.visible && typeof a.visible.number === 'number' && a.visible.number > 0) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        return a.visible.number as number;
      }
    }
  }
  return null;
}

/** 从当前 URL 提取 near（/d/:id/:near 或 ?near=） */
function extractNearFromUrl(): number | null {
  try {
    const url = new URL(window.location.href);

    // 1) 路径段 /d/:id/:near
    const parts = url.pathname.split('/').filter(Boolean);
    const dIndex = parts.indexOf('d');
    if (dIndex !== -1 && parts.length > dIndex + 2) {
      const maybeNear = parseInt(parts[dIndex + 2], 10);
      if (!Number.isNaN(maybeNear) && maybeNear > 0) return maybeNear;
    }

    // 2) 查询参数 ?near=
    const qNear = parseInt(url.searchParams.get('near') || '', 10);
    if (!Number.isNaN(qNear) && qNear > 0) return qNear;
  } catch {
    // ignore
  }
  return null;
}

/** 退路：取“视口顶部相交”的第一楼（部分可见即可），更贴近原生体验 */
function extractTopPartiallyVisible(): number | null {
  const items = document.querySelectorAll<HTMLElement>('.PostStream-item[data-number]');
  const viewportTop = 0 + 4; // 给 4px 容忍，避免顶部边框抖动
  for (const el of Array.from(items)) {
    const rect = el.getBoundingClientRect();
    // 只要顶部在视口上方/内，且底部仍在视口下方（有任意可见面积）
    if (rect.top <= viewportTop && rect.bottom > viewportTop) {
      const n = parseInt(el.dataset.number || '', 10);
      if (n > 0) return n;
    }
  }
  // 若没有正好跨过顶部的，择第一个“下半部进入视口”的
  for (const el of Array.from(items)) {
    const rect = el.getBoundingClientRect();
    if (rect.top >= viewportTop && rect.top < (window.innerHeight || 0)) {
      const n = parseInt(el.dataset.number || '', 10);
      if (n > 0) return n;
    }
  }
  return null;
}

/** 写库（静默失败即可） */
function savePosition(discussionId: string, postNumber: number) {
  return app
    .request({
      method: 'POST',
      url: `${app.forum.attribute('apiUrl')}/ladybyron/reading-position`,
      body: { discussionId, postNumber },
    })
    .catch(() => {});
}

/** 轻节流与只前进：避免高频/倒退写入 */
const lastSentByDiscussion: Record<string, number> = Object.create(null);
const pendingTimerByDiscussion: Record<string, number> = Object.create(null);

function scheduleSaveForwardOnly(discussion: any, candidate: number) {
  const id: string = discussion.id();
  const currentSaved = discussion.attribute('lbReadingPosition') ?? 0;
  const lastSent = lastSentByDiscussion[id] ?? 0;

  // 只前进：新数必须 > 两个本地参照
  const target = Math.max(candidate | 0, 0);
  if (!(target > currentSaved && target > lastSent)) return;

  // 合并 200ms 内的多次抖动，只保留最大值
  lastSentByDiscussion[id] = target;
  if (pendingTimerByDiscussion[id]) window.clearTimeout(pendingTimerByDiscussion[id]);

  pendingTimerByDiscussion[id] = window.setTimeout(() => {
    const toSend = lastSentByDiscussion[id];
    // 二次确认“只前进”
    if (!(toSend > (discussion.attribute('lbReadingPosition') ?? 0))) return;

    savePosition(id, toSend).then(() => {
      // 同步到模型，供列表改写 near 立即可用
      if (discussion.attribute('lbReadingPosition') !== toSend) {
        discussion.pushAttributes({ lbReadingPosition: toSend });
      }
    });
  }, 200);
}

app.initializers.add('lady-byron/reading-enhance', () => {
  /**
   * A) 改写“讨论列表项”里的 <Link>（与原先一致）：
   *    - 跳过搜索页（this.attrs.params.q 存在时不改写）
   *    - 用 lbReadingPosition 作为 near
   *    - 兼容 v17 blog
   */
  extend(DiscussionListItem.prototype, 'view', function (vdom: any) {
    // 搜索结果保留“最相关”默认体验
    if ((this as any).attrs?.params?.q) return;

    const discussion = (this as any).attrs?.discussion;
    if (!discussion) return;

    const recorded: number | null = discussion.attribute('lbReadingPosition') ?? null;
    if (!recorded || recorded <= 1) return; // 无记录或仅 1 楼则不带 near

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

  /**
   * B) 与原生同步的“阅读位置 → 实时写库”：
   *    - 直接复用 PostStream 的 onPositionChange（与原生 URL 更新同源）
   *    - 回调缺失/不可判读时：回退 URL near → 回退顶部相交探测
   *    - 仅向前推进 + 200ms 合并
   */
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

          // 1) 首选：从回调参数还原（与原生完全一致的来源）
          let n = derivePostNumberFromPositionChangeArgs(cbArgs);

          // 2) 回退：从 URL 近因（原生滚动时会同步 near 到地址栏）
          if (!n) n = extractNearFromUrl();

          // 3) 最后退路：顶部相交的首个部分可见楼层
          if (!n) n = extractTopPartiallyVisible();

          if (n && typeof n === 'number' && n > 0) {
            scheduleSaveForwardOnly(discussion, n);
          }
        };
      }
    };

    inject(vdom);
    return vdom;
  });
});
