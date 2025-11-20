import app from 'flarum/forum/app';
import { extend, override } from 'flarum/common/extend';
import DiscussionListItem from 'flarum/forum/components/DiscussionListItem';
import DiscussionPage from 'flarum/forum/components/DiscussionPage';
import PostStream from 'flarum/forum/components/PostStream';
import Link from 'flarum/common/components/Link';
import Discussion from 'flarum/common/models/Discussion';
import { savePosition, getBestPostNumber } from '../utils/ReadingState';

export default function registerViewModifications() {
  
  // --- 1. 修改列表页 (DiscussionListItem) ---
  extend(DiscussionListItem.prototype, 'view', function (vdom) {
    // 搜索结果页不处理，保持相关度排序
    if (this.attrs.params?.q) return;

    const discussion = this.attrs.discussion as Discussion;
    if (!discussion) return;

    const targetPost = getBestPostNumber(discussion);
    if (targetPost <= 1) return;

    // 递归查找 Link 组件并修改
    const modifyLinks = (node: any) => {
      if (!node) return;
      if (Array.isArray(node)) return node.forEach(modifyLinks);

      // 找到 Link 组件，且该链接指向当前主题
      if (node.tag === Link && node.attrs?.href && node.attrs.href.includes(discussion.slug())) {
        
        // 兼容 v17development-blog 逻辑
        const isBlog = shouldRedirectToBlog(discussion);
        
        if (isBlog) {
           node.attrs.href = app.route('blogArticle.near', { id: discussion.slug(), near: targetPost });
        } else {
           // 标准帖子：生成带 /5 的链接
           node.attrs.href = app.route.discussion(discussion, targetPost);
        }
      }
      
      if (node.children) modifyLinks(node.children);
    };

    modifyLinks(vdom);
  });

  // --- 2. 监听阅读页滚动 (DiscussionPage) ---
  override(DiscussionPage.prototype, 'view', function (original) {
    const vdom = original();
    
    if (!this.discussion || !app.session.user) return vdom;

    // 注入 onPositionChange 到 PostStream
    const injectProps = (node: any) => {
      if (!node) return;
      
      if (node.tag === PostStream) {
        const originalHandler = node.attrs.onPositionChange;
        
        // 劫持回调：当 Flarum 认为位置变了，我们也记录
        node.attrs.onPositionChange = (state: any) => {
          if (originalHandler) originalHandler(state);
          
          // state.postNumber 是 Flarum 计算好的当前顶部楼层
          if (state && typeof state.postNumber === 'number') {
            savePosition(this.discussion, state.postNumber);
          }
        };
        return; // 找到 PostStream 后可停止同级搜索
      }

      if (node.children) {
        if (Array.isArray(node.children)) node.children.forEach(injectProps);
        else injectProps(node.children);
      }
    };

    injectProps(vdom);
    return vdom;
  });
}

/**
 * 辅助：判断是否应该跳转到 Blog 界面
 */
function shouldRedirectToBlog(discussion: Discussion): boolean {
  // @ts-ignore
  if (!('v17development-blog' in flarum.extensions)) return false;
  
  const redirects = app.forum.attribute('blogRedirectsEnabled');
  if (redirects !== 'both' && redirects !== 'discussions_only') return false;

  const blogTags = app.forum.attribute<string[]>('blogTags') || [];
  const tags = discussion.tags() || [];
  
  return tags.some(tag => {
     if (!tag) return false;
     return blogTags.includes(tag.id()) || (tag.parent() && blogTags.includes(tag.parent()!.id()));
  });
}
