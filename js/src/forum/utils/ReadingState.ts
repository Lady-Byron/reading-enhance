import app from 'flarum/forum/app';
import Discussion from 'flarum/common/models/Discussion';

const DEBOUNCE_MS = 200;
let saveTimeout: number | null = null;
// 内存缓存，防止重复提交
const lastSavedPosition: Record<string, number> = {};

/**
 * 计算该主题的最佳跳转楼层
 * 优先级：插件记录 (lb) > 原生记录 (lastRead) > 1
 */
export function getBestPostNumber(discussion: Discussion): number {
  // 1. 插件记录 (Store / Attribute)
  const lbPos = discussion.attribute<number>('lbReadingPosition');
  if (lbPos && lbPos > 1) return lbPos;

  // 2. Flarum 原生记录
  const nativePos = discussion.lastReadPostNumber();
  if (nativePos && nativePos > 1) return nativePos;

  // 3. 默认
  return 1;
}

/**
 * 保存阅读位置到后端 (带防抖)
 */
export function savePosition(discussion: Discussion, postNumber: number) {
  if (!discussion || !postNumber || postNumber <= 1) return;
  
  const id = discussion.id();

  // 检查是否与上次提交一致，或者与当前模型一致，避免重复
  if (lastSavedPosition[id] === postNumber) return;
  if (discussion.attribute('lbReadingPosition') === postNumber) return;

  if (saveTimeout) window.clearTimeout(saveTimeout);

  saveTimeout = window.setTimeout(() => {
    lastSavedPosition[id] = postNumber;
    
    // 乐观更新：立即更新前端 Model，让 UI 反应迅速
    discussion.pushAttributes({ lbReadingPosition: postNumber });

    app.request({
      method: 'POST',
      url: `${app.forum.attribute('apiUrl')}/ladybyron/reading-position`,
      body: { discussionId: id, postNumber },
    }).catch((err) => {
      console.error('[LadyByron] Failed to save position:', err);
    });
  }, DEBOUNCE_MS);
}
