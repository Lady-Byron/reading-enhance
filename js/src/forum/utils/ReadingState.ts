// js/src/forum/utils/ReadingState.ts
import app from 'flarum/forum/app';
import Discussion from 'flarum/common/models/Discussion';

let saveTimeout: number | null = null;
const lastSaved: Record<string, number> = {};

export function savePosition(discussion: Discussion, postNumber: number) {
  if (!discussion || !postNumber || postNumber <= 1) return;

  const id = discussion.id();
  
  // 防抖 + 重复检查
  if (lastSaved[id] === postNumber) return;
  if (discussion.attribute('lbReadingPosition') === postNumber) return;

  if (saveTimeout) clearTimeout(saveTimeout);

  saveTimeout = window.setTimeout(() => {
    lastSaved[id] = postNumber;
    
    // 乐观更新前端模型
    discussion.pushAttributes({ lbReadingPosition: postNumber });

    app.request({
      method: 'POST',
      url: `${app.forum.attribute('apiUrl')}/ladybyron/reading-position`,
      body: { discussionId: id, postNumber }
    }).catch(console.error);
  }, 200);
}

export function getBestPostNumber(discussion: Discussion): number {
  // 优先取插件记录，其次原生记录，最后 1
  const lb = discussion.attribute<number>('lbReadingPosition');
  const native = discussion.lastReadPostNumber();
  return (lb && lb > 1) ? lb : (native && native > 1 ? native : 1);
}
