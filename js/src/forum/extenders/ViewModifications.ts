// js/src/forum/extenders/ViewModifications.ts
import app from 'flarum/forum/app';
import { extend, override } from 'flarum/common/extend';
import DiscussionListItem from 'flarum/forum/components/DiscussionListItem';
import DiscussionPage from 'flarum/forum/components/DiscussionPage';
import PostStream from 'flarum/forum/components/PostStream';
import Link from 'flarum/common/components/Link';
import { savePosition, getBestPostNumber } from '../utils/ReadingState';

export default function registerViewModifications() {
  
  // 1. 修改列表页链接
  extend(DiscussionListItem.prototype, 'view', function (vdom) {
    if (this.attrs.params?.q) return; // 忽略搜索页

    const discussion = this.attrs.discussion;
    const targetPost = getBestPostNumber(discussion);
    if (targetPost <= 1) return;

    // 递归修改 Link href (比 querySelector 更高效且符合 Mithril 思想)
    const walk = (node: any) => {
      if (!node) return;
      if (Array.isArray(node)) return node.forEach(walk);
      
      if (node.tag === Link && node.attrs?.href) {
        // 确保只修改指向该主题的主链接
        // 这是一个简单的启发式判断，通常 discussion link 没有 title 属性或者 class 包含 main
        if (node.attrs.href.includes(discussion.slug())) {
            // 检测 Blog 插件 (兼容逻辑)
            // @ts-ignore
            if ('v17development-blog' in flarum.extensions && discussion.tags()?.some(t => app.forum.attribute('blogTags')?.includes(t.id()))) {
                node.attrs.href = app.route('blogArticle.near', { id: discussion.slug(), near: targetPost });
            } else {
                node.attrs.href = app.route.discussion(discussion, targetPost);
            }
        }
      }
      if (node.children) walk(node.children);
    };
    walk(vdom);
  });

  // 2. 监听阅读页滚动
  override(DiscussionPage.prototype, 'view', function (original) {
    const vdom = original();
    
    if (!this.discussion || !app.session.user) return vdom;

    const inject = (node: any) => {
      if (!node) return;
      if (node.tag === PostStream) {
        const oldChange = node.attrs.onPositionChange;
        node.attrs.onPositionChange = (state: any) => {
          if (oldChange) oldChange(state);
          // Flarum 1.8 state 包含 postNumber
          if (state && state.postNumber) {
             savePosition(this.discussion, state.postNumber);
          }
        };
      } else if (node.children) {
        if (Array.isArray(node.children)) node.children.forEach(inject);
        else inject(node.children);
      }
    };
    
    inject(vdom);
    return vdom;
  });
}
