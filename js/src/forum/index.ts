// js/src/forum/index.ts
import app from 'flarum/forum/app';
import { extend, override } from 'flarum/common/extend';
import DiscussionListItem from 'flarum/forum/components/DiscussionListItem';
import DiscussionPage from 'flarum/forum/components/DiscussionPage';
import PostStream from 'flarum/forum/components/PostStream';
import Link from 'flarum/common/components/Link';

// 可选加载：有的构建下没有这个导出
let DiscussionSearchResult: any = null;
try {
  // @ts-ignore
  DiscussionSearchResult = require('flarum/forum/components/DiscussionSearchResult').default;
} catch { /* noop */ }

/** ===== Blog 路由判定（复刻 clark 插件逻辑） ===== */
function shouldRedirectDiscussionToBlog(discussion: any): boolean {
  // @ts-ignore: flarum.extensions 来自全局
  if (!('v17development-blog' in flarum.extensions)) return false;

  const redirects = app.forum.attribute('blogRedirectsEnabled');
  const discussionRedirectEnabled = redirects === 'both' || redirects === 'discussions_only';

  const tags = discussion.tags?.() || [];
  if (!discussionRedirectEnabled || tags.length === 0) return false;

  const blogTags: string[] = app.forum.attribute('blogTags') || [];

  return tags.some((tag: any) => {
    if (!tag) return false;
    const parent = tag.parent?.() || null;
    return (
      blogTags.indexOf(tag.id?.()!) !== -1 ||
      (parent && blogTags.indexOf(parent.id?.()!) !== -1)
    );
  });
}

/** 链接是否已有显式目标（尊重不改） */
function hrefHasExplicitTarget(href: string): boolean {
  return /[?&]near=\d+/.test(href) || /\/d\/[^/]+\/\d+(?:[/?#]|$)/.test(href) || /#p\d+/.test(href);
}

/** 生成“正确”的进入讨论链接（严格复刻插件做法，兼容 Blog） */
function buildDiscussionHref(discussion: any, recorded: number | null): string {
  const n = recorded && recorded > 1 ? recorded : 0;

  if (shouldRedirectDiscussionToBlog(discussion)) {
    if (n > 1) {
      return app.route('blogArticle.near', { id: discussion.slug(), near: n });
    } else {
      return app.route('blogArticle', { id: discussion.slug() });
    }
  }

  // 非 Blog：直接走核心
  return app.route.discussion(discussion, n);
}

/** 视口顶部“完全可见”的楼层号（写库用） */
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
  /** A) 讨论列表：复刻 clark 的写法，直接生成 href（含 Blog 分支） */
  extend(DiscussionListItem.prototype, 'view', function (vdom: any) {
    const discussion = (this as any).attrs?.discussion;
    if (!discussion) return;

    const recorded: number | null = discussion.attribute('lbReadingPosition') ?? null;

    // 遍历到 content 容器，再找里面的 Link（与 clark 插件一致）
    (vdom.children as any[]).forEach((c: any) => {
      if (!c || !c.attrs?.className || c.attrs.className.indexOf('DiscussionListItem-content') === -1) return;

      (c.children as any[]).forEach((sub: any) => {
        if (!sub || sub.tag !== Link) return;

        // 若原 href 已显式指楼层，则尊重原样（不覆盖）
        if (sub.attrs?.href && hrefHasExplicitTarget(sub.attrs.href)) return;

        sub.attrs.href = buildDiscussionHref(discussion, recorded);
      });
    });
  });

  /** B) 搜索下拉：若组件存在，做同样的 href 生成（含 Blog 分支） */
  if (DiscussionSearchResult && DiscussionSearchResult.prototype) {
    extend(DiscussionSearchResult.prototype, 'view', function (vdom: any) {
      const discussion = (this as any).attrs?.discussion;
      if (!discussion) return;

      const recorded: number | null = discussion.attribute('lbReadingPosition') ?? null;

      // 搜索条目结构简单，直接找第一个 Link
      (vdom.children as any[]).forEach((sub: any) => {
        if (!sub || sub.tag !== Link) return;

        if (sub.attrs?.href && hrefHasExplicitTarget(sub.attrs.href)) return;

        sub.attrs.href = buildDiscussionHref(discussion, recorded);
      });
    });
  }

  /** C) 深链兜底：/d/slug 直接打开且无 near/#pN 时，替换为“正确路由” */
  extend(DiscussionPage.prototype, 'show', function (_ret: any, discussion: any) {
    if (!discussion) return;

    const current = m.route.get();
    if (hrefHasExplicitTarget(current)) return;

    const recorded: number | null = discussion.attribute('lbReadingPosition') ?? null;
    const target = buildDiscussionHref(discussion, recorded);

    if (current !== target) {
      m.route.set(target, undefined, { replace: true });
    }
  });

  /** D) 实时写库：官方节流时机 */
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
