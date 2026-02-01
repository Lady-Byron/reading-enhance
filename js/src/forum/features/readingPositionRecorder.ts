// js/src/forum/features/readingPositionRecorder.ts
import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import DiscussionPage from 'flarum/forum/components/DiscussionPage';

/**
 * 写库（lb_read_post_number；静默失败即可）
 */
function savePosition(discussionId: string, postNumber: number) {
  return app
    .request({
      method: 'POST',
      url: `${app.forum.attribute('apiUrl')}/ladybyron/reading-position`,
      body: { discussionId, postNumber },
    })
    .catch(() => {
      // 静默失败，不影响前端体验
    });
}

/**
 * 200ms 轻节流 + 去重（按讨论维度）
 * #10: 增加 LRU 上限，防止长时间标签页内存泄漏
 */

const DEBOUNCE_MS = 200;
const MAX_TRACKED = 50;

const pendingTimerByDiscussion: Record<string, number> = Object.create(null);
const pendingCandidateByDiscussion: Record<string, number> = Object.create(null);
const lastCommittedByDiscussion: Record<string, number> = Object.create(null);
const accessOrder: string[] = [];

function touchLru(id: string) {
  const idx = accessOrder.indexOf(id);
  if (idx !== -1) accessOrder.splice(idx, 1);
  accessOrder.push(id);

  while (accessOrder.length > MAX_TRACKED) {
    const evict = accessOrder.shift()!;
    if (pendingTimerByDiscussion[evict]) {
      window.clearTimeout(pendingTimerByDiscussion[evict]);
    }
    delete pendingTimerByDiscussion[evict];
    delete pendingCandidateByDiscussion[evict];
    delete lastCommittedByDiscussion[evict];
  }
}

function scheduleSave(discussion: any, candidate: number) {
  const id: string = discussion.id?.() ?? discussion.id;
  if (!id) return;

  touchLru(id);

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

    savePosition(id, toSend).then(() => {
      lastCommittedByDiscussion[id] = toSend;

      // 本地模型同步，方便导航增强使用
      if (discussion.attribute && discussion.attribute('lbReadingPosition') !== toSend) {
        discussion.pushAttributes({ lbReadingPosition: toSend });
      }
    });
  }, DEBOUNCE_MS);
}

let installed = false;

export default function installReadingPositionRecorder() {
  if (installed) return;
  installed = true;

  app.initializers.add('lady-byron/reading-enhance-recorder', () => {
    // 直接扩展 DiscussionPage.positionChanged — Flarum 在 PostStream 滚动时调用此方法
    // 签名: positionChanged(startNumber: number, endNumber: number): void
    // extend 回调接收 (returnValue, ...originalArgs)，positionChanged 返回 void
    extend(DiscussionPage.prototype, 'positionChanged', function (_ret: void, startNumber: number) {
      if (!app.session.user) return;

      const discussion = (this as any).discussion;
      if (!discussion) return;

      if (typeof startNumber === 'number' && startNumber > 0) {
        scheduleSave(discussion, startNumber);
      }
    });
  });
}
