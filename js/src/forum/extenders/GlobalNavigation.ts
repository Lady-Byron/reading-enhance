import app from 'flarum/forum/app';
import { getBestPostNumber } from '../utils/ReadingState';
import { parseDiscussionIdFromUrl, isSameOrigin } from '../utils/UrlHelpers';

export default function registerGlobalNavigation() {
  
  // 使用捕获阶段监听，确保在 Flarum 路由处理前拦截
  document.body.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('a');
    if (!target || !target.href) return;

    // 1. 基础检查：同源且有 href
    let url: URL;
    try { 
      url = new URL(target.href); 
    } catch { return; }
    
    if (!isSameOrigin(url)) return;

    // 2. 解析 ID，必须是 /d/123 格式
    const id = parseDiscussionIdFromUrl(url);
    if (!id) return;

    // 3. 排除显式指定了位置的链接 (near, page, specific post)
    // 如果 URL 已经是 /d/123/5 或 ?near=5，我们不干预
    const parts = url.pathname.split('/').filter(Boolean);
    const hasExplicitPost = parts.length > 2 && /^\d+$/.test(parts[2]); // /d/id/123
    if (hasExplicitPost || url.searchParams.has('near')) return;

    // 4. 查找最佳跳转位置
    const discussion = app.store.getById('discussions', id);
    if (discussion) {
      const bestPos = getBestPostNumber(discussion);
      
      if (bestPos > 1) {
        // 命中！阻止默认跳转，使用 Mithril 路由到指定楼层
        e.preventDefault();
        e.stopPropagation();
        app.route.discussion(discussion, bestPos);
      }
    }
  }, true);
}
