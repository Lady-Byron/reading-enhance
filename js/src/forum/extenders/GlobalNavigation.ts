import app from 'flarum/forum/app';
import { getBestPostNumber } from '../utils/ReadingState';
import { parseDiscussionIdFromUrl, isSameOrigin } from '../utils/UrlHelpers';

export default function registerGlobalNavigation() {
  console.log('[LadyByron] Global navigation handler registered');

  document.body.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('a');
    if (!target || !target.href) return;

    let url: URL;
    try { 
      url = new URL(target.href); 
    } catch { return; }
    
    if (!isSameOrigin(url)) return;

    // 排除显式指定了位置的链接 /d/123/5 或 ?near=5
    if (url.searchParams.has('near') || url.pathname.split('/').length > 3) return;

    const id = parseDiscussionIdFromUrl(url);
    if (!id) return;

    const discussion = app.store.getById('discussions', id);
    
    // [Debug] 输出点击诊断信息
    // console.log('[LadyByron] Clicked discussion:', id, discussion ? 'Found' : 'Not in store');

    if (discussion) {
      const bestPos = getBestPostNumber(discussion);
      // console.log('[LadyByron] Calculated best pos:', bestPos);
      
      if (bestPos > 1) {
        e.preventDefault();
        e.stopPropagation();
        
        // 生成目标 URL
        const targetUrl = app.route.discussion(discussion, bestPos);
        
        console.log('[LadyByron] Redirecting to:', targetUrl);
        
        // [修复点] 真正执行路由跳转
        // 注意：m.route.set 需要相对路径或完整路径，Flarum 环境下通常都能处理，
        // 但为了保险，我们从 app.route 生成的完整 URL 中提取路径部分
        const targetPath = targetUrl.replace(window.location.origin, '');
        
        // @ts-ignore
        m.route.set(targetPath);
      }
    }
  }, true);
}
