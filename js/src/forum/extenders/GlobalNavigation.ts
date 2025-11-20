import app from 'flarum/forum/app';
import { getBestPostNumber } from '../utils/ReadingState';

export default function registerGlobalNavigation() {
  document.body.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('a');
    if (!target || !target.href) return;

    // 只处理内部链接
    const url = new URL(target.href);
    if (url.origin !== window.location.origin) return;

    // 解析 /d/123
    const match = url.pathname.match(/\/d\/(\d+)/);
    if (!match) return;
    const id = match[1];

    // 如果链接显式带了 near/页码，不处理
    if (url.searchParams.has('near') || url.pathname.split('/').length > 3) return;

    const discussion = app.store.getById('discussions', id);
    if (discussion) {
      const best = getBestPostNumber(discussion);
      if (best > 1) {
        e.preventDefault();
        e.stopPropagation();
        app.route.discussion(discussion, best);
      }
    }
  }, true); // 捕获阶段
}
