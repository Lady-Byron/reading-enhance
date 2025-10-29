// js/src/forum/index.ts
import app from 'flarum/forum/app';
import { extend, override } from 'flarum/common/extend';
import DiscussionListItem from 'flarum/forum/components/DiscussionListItem';
import DiscussionPage from 'flarum/forum/components/DiscussionPage';
import PostStream from 'flarum/forum/components/PostStream';
import Link from 'flarum/common/components/Link';

// 兼容有些构建下未导出的情况：用 require 尝试获取（存在才扩展）
declare const require: any;
let DiscussionSearchResult: any = null;
try {
  DiscussionSearchResult = require('flarum/forum/components/DiscussionSearchResult').default;
} catch { /* noop */ }

/** ---- 复制自 clark 插件的 blog 路由判定（简化版，内联） ---- */
function shouldRedirectDiscussionToBlog(discussion: any): boolean {
  // 没装 v17 blog 就直接 false
  // @ts-ignore
  if (!('v17development-blog' in flarum.extensions)) return false;

  const redirects = app.forum.attribute('blogRedirectsEnabled');
  const discussionRedirectEnabled =
    redirects === 'both' || redirects === 'discussions_only';

  const tags = discussion.tags?.() || [];
  if (!discussionRedirectEnabled || tags.length === 0) return false;

  const blogTags = (app.forum.attribute('blogTags') as string[]) || [];

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

/** 显式目标判定：有 near、/d/.../N、或 #pN 则不覆盖 */
function hasExplicitTarget(href: string): boolean {
  return /[?&]near=\d+/.test(href) || /\/d\/[^/]+\/\d+(?:[/?#]|$)/.test(href) || /#p\d+/.test(href);
}

/** 构造“正确”的目标 href（完全复刻思路：Blog 用 blogArticle(.near)，否则 app.route.discussion） */
function buildDiscussionHref(discussion: any, nearOrZero: number): string {
  const n = nearOrZero && nearOrZero > 1 ? nearOrZero : 0;

  if (shouldRedirectDiscussionToBlog(discussion)) {
    return n > 1
      ? app.route('blogArticle.near', { id: discussion.slug(), near: n })
      : app.route('blogArticle', { id: discussion.slug() });
  }

  return app.route.discussion(discussion, n);
}

/** 取视口顶部完全可见的楼层号（保存“最后稳定停留处”用） */
function extractTopFullyVisiblePostNumber(): number | null {
  const items = document.querySelectorAll<HTMLElement>('.PostStream-item[data-number]');
  for (const el of Array.from(items)) {
    const rect = el.getBoundingClientRect();
    if (rect.top >= 0 && rect.bottom <= (window.innerHeight || 0)) {
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

app.initializers.add('lady-byron/reading-enhance', () => {
  /**
   * A) 讨论列表：严格沿用你“已确认生效”的方式
   *    - 不再跳过搜索页：现在连“全页搜索结果”也会按记录楼层打开
   *    - 额外增加：若原 href 已显式指楼层，则尊重不覆盖
   */
  extend(DiscussionListItem.prototype, 'view', function (vdom: any) {
    const discussion = (this as any).attrs?.discussion;
    if (!discussion) return;

    const recorded: number | null = discussion.attribute('lbReadingPosition') ?? null;
    if (!recorded || recorded <= 1) return; // 没有记录或仅 1 楼，无需 near

    // 与 clark 插件一致的 vnode 命中方式：定位到 .DiscussionListItem-content 内的第一个 Link
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

        const orig = sub.attrs?.href as string | undefined;
        if (orig && hasExplicitTarget(orig)) return; // 显式目标 → 保持原样

        sub.attrs.href = buildDiscussionHref(discussion, recorded!);
      });
    });
  });

  /**
   * B) 搜索下拉：如果组件存在，按相同思路重写其中的 Link
   *    - 这里没有 .DiscussionListItem-content，直接找子级 Link 即可
   *    - 同样尊重显式目标
   */
  if (DiscussionSearchResult && DiscussionSearchResult.prototype) {
    extend(DiscussionSearchResult.prototype, 'view', function (vdom: any) {
      const discussion = (this as any).attrs?.discussion;
      if (!discussion) return;

      const recorded: number | null = discussion.attribute('lbReadingPosition') ?? null;
      if (!recorded || recorded <= 1) return;

      (vdom.children as any[]).forEach((sub: any) => {
        if (!sub || sub.tag !== Link) return;

        const orig = sub.attrs?.href as string | undefined;
        if (orig && hasExplicitTarget(orig)) return;

        sub.attrs.href = buildDiscussionHref(discussion, recorded!);
      });
    });
  }

  /**
   * C) 深链兜底：用户直接打开 /d/slug 且无 near/#pN 时，用 replace 无刷新替换为带 near/正确路由
   *    - 仍交给核心 Resolver/PostStreamState 完成定位
   */
  extend(DiscussionPage.prototype, 'show', function (_: any, discussion: any) {
    if (!discussion) return;

    const current = m.route.get();
    if (hasExplicitTarget(current)) return; // 地址已显式指楼层 → 不覆盖

    const recorded: number | null = discussion.attribute('lbReadingPosition') ?? null;
    if (!recorded || recorded <= 1) return;

    const target = buildDiscussionHref(discussion, recorded);
    if (current !== target) {
      m.route.set(target, undefined, { replace: true });
    }
  });

  /**
   * D) 继续使用核心“位置变更节流回调”落库
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

          const n = extractTopFullyVisiblePostNumber();
          if (n && typeof n === 'number') {
            savePosition(discussion.id(), n).then(() => {
              // 同步模型，列表改写能立刻用到最新记录
              if (discussion.attribute('lbReadingPosition') !== n) {
                discussion.pushAttributes({ lbReadingPosition: n });
              }
            });
          }
        };
      }
    };

    inject(vdom);
    return vdom;
  });
});
