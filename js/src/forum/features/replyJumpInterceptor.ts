// js/src/forum/features/replyJumpInterceptor.ts
import app from 'flarum/forum/app';
import { override } from 'flarum/common/extend';
import PostStreamState from 'flarum/forum/states/PostStreamState';

/**
 * 精确令牌拦截：
 * - 仅在"提交新回复成功（POST /api/posts）"后，给对应讨论发一次性令牌。
 * - 在 goToNumber 入口（调用链顶端）命中当前讨论且目标=回复/末楼时吞掉滚动。
 * - 不影响 near 跳转、点楼号、路由初始定位等其它行为。
 *
 * 精简方案：
 * - 原来补丁 5 处（app.request + goToNumber + triggerScroll + scrollToNumber + scrollToIndex）
 * - 现在只需 2 处（app.request + override goToNumber），
 *   因为 goToNumber 是 ReplyComposer 成功后调用的唯一入口，下游方法由它触发。
 * - 使用 Flarum 标准 override 而非手动原型替换，正确参与扩展调用链。
 */

type Token = {
  did: string | null;
  targetNum: number | null;
  left: number;
  expiresAt: number;
};

const token: Token = {
  did: null,
  targetNum: null,
  left: 0,
  expiresAt: 0,
};

function activeFor(did: string | null): boolean {
  return (
    !!did &&
    token.did === did &&
    token.left > 0 &&
    Date.now() < token.expiresAt
  );
}

function arm(did: string, targetNum: number | null, ttlMs = 1800, times = 3) {
  token.did = did;
  token.targetNum = typeof targetNum === 'number' && targetNum > 0 ? targetNum : null;
  token.left = Math.max(1, times);
  token.expiresAt = Date.now() + Math.max(300, ttlMs);
}

function consume() {
  if (token.left > 0) token.left -= 1;
  if (token.left <= 0) {
    token.did = null;
    token.targetNum = null;
    token.expiresAt = 0;
  }
}

function isReplyJump(discussion: any, target: any): boolean {
  if (!discussion) return false;
  if (target === 'reply') return true;

  const last: number | null =
    typeof discussion.lastPostNumber === 'function'
      ? discussion.lastPostNumber()
      : discussion.attribute?.('lastPostNumber');

  if (typeof target === 'number' && target > 0) {
    if (typeof last === 'number' && last > 0 && target >= last) return true;
    if (token.targetNum && target >= token.targetNum) return true;
  }

  return false;
}

function installRequestHook() {
  if ((app as any).__lbReqHooked) return;
  (app as any).__lbReqHooked = true;

  const orig = app.request.bind(app);

  app.request = function (opts: any) {
    const p = orig(opts);
    try {
      const method = String(opts?.method || '').toUpperCase();
      const url = String(opts?.url || '');
      // #5: 收紧正则，只匹配 Flarum 标准的 POST /api/posts 接口
      if (method !== 'POST' || !/\/api\/posts(?:\?|$)/.test(url)) return p;

      return p.then((res: any) => {
        const did =
          res?.data?.relationships?.discussion?.data?.id ??
          res?.data?.attributes?.discussionId ??
          null;
        const num: number | null =
          typeof res?.data?.attributes?.number === 'number'
            ? res.data.attributes.number
            : null;

        if (did) {
          arm(String(did), num, 1800, 3);
        }
        return res;
      });
    } catch {
      return p;
    }
  };
}

export default function installReplyJumpInterceptor() {
  app.initializers.add('lady-byron/reading-enhance-reply-jump', () => {
    // 1) 监听"发帖成功"
    installRequestHook();

    // 2) 使用 Flarum 标准 override 拦截调用链顶端
    // override 回调签名: (original, ...originalArgs)
    override(PostStreamState.prototype, 'goToNumber', function (original: any, target: any, ...rest: any[]) {
      try {
        const discussion = (this as any).discussion;
        const did =
          typeof discussion?.id === 'function'
            ? discussion.id()
            : discussion?.id;

        if (activeFor(did) && isReplyJump(discussion, target)) {
          consume();
          return;
        }
      } catch {
        // 出错不影响原始行为
      }
      return original(target, ...rest);
    });
  });
}
