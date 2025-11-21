// js/src/forum/features/readingPositionRecorder.ts
import app from 'flarum/forum/app';
import { override } from 'flarum/common/extend';
import DiscussionPage from 'flarum/forum/components/DiscussionPage';
import PostStream from 'flarum/forum/components/PostStream';

/** ---- 工具：从 onPositionChange 的参数中提取楼号（与原版一致） ---- */
function derivePostNumberFromPositionChangeArgs(args: any[]): number | null {
  for (const a of args) {
    if (a == null) continue;

    if (typeof a === 'number') {
      if (a > 0) return a;
    } else if (typeof a === 'object') {
      if (typeof (a as any).number === 'number' && (a as any).number > 0) {
        return (a as any).number;
      }
      if (typeof (a as any).postNumber === 'number' && (a as any).postNumber > 0) {
        return (a as any).postNumber;
      }
      if (typeof (a as any).near === 'number' && (a as any).near > 0) {
        return (a as any).near;
      }
      if (
        (a as any).visible &&
        typeof (a as any).visible.number === 'number' &&
        (a as any).visible.number > 0
      ) {
        return (a as any).visible.number as number;
      }
    }
  }
  return null;
}

/** 从当前 URL 提取 near（/d/:id/:near 或 ?near=） */
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

/** 作为最后退路：扫描顶部附近的 .PostStream-item[data-number] */
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

/** 200ms 轻节流 + 去重（双向允许） */
const DEBOUNCE_MS = 200;
const pendingTimerByDiscussion: Record<string, number> = Object.create(null);
const pendingCandidateByDiscussion: Record<string, number> = Object.create(null);
const lastCommittedByDiscussion: Record<string, number> = Object.create(null);

function scheduleSaveBidirectional(discussion: any, candidate: number) {
  const id: string = discussion.id();
  if (pendingCandidateByDiscussion[id] === candidate) return;

  pendingCandidateByDiscussion[id] = candidate;

  if (pendingTimerByDiscussion[id]) {
    window.clearTimeout(pendingTimerByDiscussion[id]);
  }

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

let attached = false;

export default function installReadingPositionRecorder() {
  if (attached) return;
  attached = true;

  app.initializers.add('lady-byron/reading-enhance-position', () => {
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
  });
}
