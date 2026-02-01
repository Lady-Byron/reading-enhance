// js/src/forum/features/readingPositionRecorder.ts
import app from 'flarum/forum/app';
import { override } from 'flarum/common/extend';
import DiscussionPage from 'flarum/forum/components/DiscussionPage';
import PostStream from 'flarum/forum/components/PostStream';

/**
 * 从 Flarum 提供的 onPositionChange 参数中提取楼层号
 * - 优先 number / postNumber / near
 * - 其次 visible.number
 */
function derivePostNumberFromPositionChangeArgs(args: any[]): number | null {
  for (const a of args) {
    if (a == null) continue;

    if (typeof a === 'number') {
      if (a > 0) return a;
    } else if (typeof a === 'object') {
      const anyA = a as any;

      if (typeof anyA.number === 'number' && anyA.number > 0) return anyA.number;
      if (typeof anyA.postNumber === 'number' && anyA.postNumber > 0) return anyA.postNumber;
      if (typeof anyA.near === 'number' && anyA.near > 0) return anyA.near;

      if (
        anyA.visible &&
        typeof anyA.visible.number === 'number' &&
        anyA.visible.number > 0
      ) {
        return anyA.visible.number as number;
      }
    }
  }

  return null;
}

/**
 * 兜底：从当前 URL 的 /d/:id/:near 或 ?near= 中提取楼层号
 */
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
  } catch {
    // 忽略 URL 解析错误
  }

  return null;
}

/**
 * 写库（lb_read_post_number）
 * 返回的 promise 在请求失败时 reject，由调用方决定如何处理。
 */
function savePosition(discussionId: string, postNumber: number) {
  return app.request({
    method: 'POST',
    url: `${app.forum.attribute('apiUrl')}/ladybyron/reading-position`,
    body: { discussionId, postNumber },
  });
}

/**
 * 200ms 轻节流 + 去重（按讨论维度）
 */

const DEBOUNCE_MS = 200;

const pendingTimerByDiscussion: Record<string, number> = Object.create(null);
const pendingCandidateByDiscussion: Record<string, number> = Object.create(null);
const lastCommittedByDiscussion: Record<string, number> = Object.create(null);

/** 当前活跃的讨论 ID；切换讨论时清理旧条目防止内存泄漏 */
let activeDiscussionId: string | null = null;

function cleanupStaleEntries(currentId: string) {
  if (activeDiscussionId && activeDiscussionId !== currentId) {
    const old = activeDiscussionId;
    if (pendingTimerByDiscussion[old]) {
      window.clearTimeout(pendingTimerByDiscussion[old]);
    }
    delete pendingTimerByDiscussion[old];
    delete pendingCandidateByDiscussion[old];
    delete lastCommittedByDiscussion[old];
  }
  activeDiscussionId = currentId;
}

function scheduleSaveBidirectional(discussion: any, candidate: number) {
  const id: string = discussion.id?.() ?? discussion.id;
  if (!id) return;

  cleanupStaleEntries(id);

  // 同一讨论内，如果 candidate 没变，就不重复 schedule
  if (pendingCandidateByDiscussion[id] === candidate) return;

  pendingCandidateByDiscussion[id] = candidate;

  if (pendingTimerByDiscussion[id]) {
    window.clearTimeout(pendingTimerByDiscussion[id]);
  }

  pendingTimerByDiscussion[id] = window.setTimeout(() => {
    const toSend = pendingCandidateByDiscussion[id];
    if (typeof toSend !== 'number' || toSend <= 0) return;

    const current = discussion.attribute?.('lbReadingPosition') ?? 0;
    const lastCommitted = lastCommittedByDiscussion[id] ?? current;

    // 和当前记录、上一次成功写入都相同的话，就不写了
    if (toSend === current || toSend === lastCommitted) return;

    savePosition(id, toSend).then(
      () => {
        lastCommittedByDiscussion[id] = toSend;

        // 本地模型同步一份，方便导航增强使用
        if (discussion.attribute && discussion.attribute('lbReadingPosition') !== toSend) {
          discussion.pushAttributes({ lbReadingPosition: toSend });
        }
      },
      () => {
        // 请求失败：不更新本地状态，下次滚动时允许重试
      }
    );
  }, DEBOUNCE_MS);
}

let installed = false;

export default function installReadingPositionRecorder() {
  if (installed) return;
  installed = true;

  app.initializers.add('lady-byron/reading-enhance-recorder', () => {
    // 覆写 DiscussionPage.view，在 VDOM 树里找到 PostStream，挂钩 onPositionChange
    override(DiscussionPage.prototype, 'view', function (original: any, ...args: any[]) {
      const vdom = original(...args);

      const inject = (node: any) => {
        if (!node) return;

        if (Array.isArray(node)) {
          node.forEach(inject);
          return;
        }

        if (node.children) inject(node.children);

        if (node.tag === PostStream) {
          node.attrs = node.attrs || {};
          const prev = node.attrs.onPositionChange;

          node.attrs.onPositionChange = (...cbArgs: any[]) => {
            // 先让原有回调跑一遍
            if (typeof prev === 'function') prev(...cbArgs);

            // 未登录用户无需记录阅读进度
            if (!app.session.user) return;

            const dp = this as any;
            const discussion = dp?.discussion;
            if (!discussion) return;

            // 1) 首选：从 Flarum 提供的 onPositionChange 参数里直接拿楼层号
            let n = derivePostNumberFromPositionChangeArgs(cbArgs);

            // 2) 兜底：偶发情况下从 URL 的 :near / ?near 读一次
            if (!n) n = extractNearFromUrl();

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
