import app from 'flarum/forum/app';
import { override } from 'flarum/common/extend';
import PostStreamState from 'flarum/forum/states/PostStreamState';
import PostStream from 'flarum/forum/components/PostStream';

/**
 * 令牌管理器：管理发帖后的“禁止跳转”权限
 */
class JumpToken {
  private did: string | null = null;
  private targetNum: number | null = null;
  private left = 0;
  private expiresAt = 0;

  // 激活令牌：发帖成功后调用
  arm(did: string, targetNum: number | null) {
    this.did = did;
    this.targetNum = targetNum;
    this.left = 3; // 允许拦截 3 次滚动指令
    this.expiresAt = Date.now() + 2000; // 2秒内有效
  }

  // 检查令牌是否有效
  isActive(did: string | null): boolean {
    return !!did && this.did === did && this.left > 0 && Date.now() < this.expiresAt;
  }

  // 消耗一次拦截机会
  consume() {
    if (this.left > 0) this.left--;
  }

  getTarget() {
    return this.targetNum;
  }
}

const token = new JumpToken();

function shouldIntercept(discussion: any, target: any): boolean {
  if (!discussion) return false;
  
  // 如果目标是 'reply' (点击回复框)
  if (target === 'reply') return true;

  const tokenTarget = token.getTarget();

  // 如果目标是数字 (楼层号)
  if (typeof target === 'number' && target > 0) {
    // 如果目标楼层 >= 发帖返回的新楼层 -> 拦截
    if (tokenTarget && target >= tokenTarget) return true;
    
    // 或者目标楼层 >= 当前最大楼层 -> 拦截
    const last = discussion.lastPostNumber();
    if (last && target >= last) return true;
  }
  
  return false;
}

export default function installReplyJumpGuard() {
  // 1. 拦截 API 请求，捕获发帖成功的时刻
  // @ts-ignore
  override(app, 'request', function (original, options) {
    const promise = original(options);
    
    try {
      const method = options?.method?.toUpperCase();
      const url = options?.url || '';
      
      // 侦测 POST /api/posts
      if (method === 'POST' && /\/posts(?:\?|$|\/)/.test(url)) {
        promise.then((res: any) => {
          const did = res?.data?.relationships?.discussion?.data?.id;
          const num = res?.data?.attributes?.number;
          if (did) {
            token.arm(did, typeof num === 'number' ? num : null);
          }
        });
      }
    } catch {}

    return promise;
  });

  // 2. 拦截 PostStreamState 的 goToNumber (核心跳转逻辑)
  // @ts-ignore
  override(PostStreamState.prototype, 'goToNumber', function (original, target, ...args) {
    const discussion = this.discussion;
    if (token.isActive(discussion?.id()) && shouldIntercept(discussion, target)) {
      token.consume();
      // 返回一个空的 Promise 吞掉跳转
      return Promise.resolve();
    }
    return original(target, ...args);
  });

  // 3. 拦截 PostStream 组件的 triggerScroll (兼容不同版本)
  if (PostStream.prototype.triggerScroll) {
    // @ts-ignore
    override(PostStream.prototype, 'triggerScroll', function (original, ...args) {
      const state = this.attrs.state;
      const discussion = state?.discussion;
      // 尝试推断目标位置
      const target = state?.targetPostNumber ?? state?.index ?? state?.visible?.number;

      if (token.isActive(discussion?.id()) && shouldIntercept(discussion, target)) {
        token.consume();
        return;
      }
      return original(...args);
    });
  }
}
