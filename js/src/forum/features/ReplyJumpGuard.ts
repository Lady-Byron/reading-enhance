// js/src/forum/features/ReplyJumpGuard.ts
import app from 'flarum/forum/app';
import { override } from 'flarum/common/extend';
import PostStream from 'flarum/forum/components/PostStream';
import PostStreamState from 'flarum/forum/states/PostStreamState';

// 令牌状态管理 (闭包封装，不再暴露全局)
class JumpToken {
  private did: string | null = null;
  private targetNum: number | null = null;
  private left = 0;
  private expiresAt = 0;

  arm(did: string, targetNum: number | null) {
    this.did = did;
    this.targetNum = targetNum;
    this.left = 3; // 允许消耗 3 次
    this.expiresAt = Date.now() + 2000; // 2秒有效期
  }

  isActive(did: string | null): boolean {
    return !!did && this.did === did && this.left > 0 && Date.now() < this.expiresAt;
  }

  consume() {
    if (this.left > 0) this.left--;
  }
}

const token = new JumpToken();

function isReplyJump(discussion: any, target: any, tokenTarget: number | null): boolean {
  if (!discussion) return false;
  if (target === 'reply') return true;
  
  // 逻辑优化：判定目标是否是新楼层
  if (typeof target === 'number' && target > 0) {
    if (tokenTarget && target >= tokenTarget) return true;
    const last = discussion.lastPostNumber();
    if (last && target >= last) return true;
  }
  return false;
}

export default function installReplyJumpGuard() {
  // 1. 安全拦截 app.request
  // @ts-ignore
  override(app, 'request', function (original, options) {
    const promise = original(options);

    // 检查是否是发帖请求 (POST /api/posts)
    if (options.method?.toUpperCase() === 'POST' && /\/posts/.test(options.url)) {
      promise.then((response: any) => {
        const did = response?.data?.relationships?.discussion?.data?.id;
        const num = response?.data?.attributes?.number;
        if (did) {
          token.arm(did, typeof num === 'number' ? num : null);
        }
      });
    }
    return promise;
  });

  // 2. 拦截 PostStreamState.goToNumber
  // @ts-ignore
  override(PostStreamState.prototype, 'goToNumber', function (original, target, ...args) {
    const discussion = this.discussion;
    if (token.isActive(discussion?.id()) && isReplyJump(discussion, target, (token as any).targetNum)) {
      token.consume();
      return Promise.resolve(); // 吞掉 promise
    }
    return original(target, ...args);
  });

  // 3. 拦截 PostStream 组件的 triggerScroll (如果存在)
  // @ts-ignore
  if (PostStream.prototype.triggerScroll) {
    // @ts-ignore
    override(PostStream.prototype, 'triggerScroll', function (original, ...args) {
       const state = this.attrs.state;
       const discussion = state?.discussion;
       // 尝试从 state 中获取目标
       const target = state?.targetPostNumber ?? state?.index ?? null;
       
       if (token.isActive(discussion?.id()) && isReplyJump(discussion, target, (token as any).targetNum)) {
         token.consume();
         return; 
       }
       return original(...args);
    });
  }
}
