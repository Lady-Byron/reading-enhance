// js/src/forum/features/replyJumpInterceptor.ts
import app from 'flarum/forum/app';
import PostStreamState from 'flarum/forum/states/PostStreamState';
import PostStream from 'flarum/forum/components/PostStream';

/**
 * 精确令牌拦截：
 * - 仅在“提交新回复成功（POST /posts）”后，给对应讨论 did 上一次性令牌（可消费 2~3 次滚动入口）。
 * - 在 goToNumber('reply') / scrollToNumber(newNumber) / triggerScroll等入口，命中当前讨论且目标=回复/末楼时吞掉滚动。
 * - 不影响 near 跳转、点楼号、路由初始定位等其它行为。
 */

type Token = {
  targetNum: number | null; // 新回复的楼号（来自 POST /posts 响应）
  left: number;             // 可吞次数（冗余入口链路下通常 2~3 次足够）
  expiresAt: number;        // TTL，毫秒级
};

/** 按讨论 ID 存储令牌，避免多讨论快速发帖时互相覆盖 */
const tokens: Record<string, Token> = Object.create(null);

function now() {
  return Date.now();
}

function getToken(did: string): Token | null {
  const t = tokens[did];
  if (!t) return null;
  if (t.left <= 0 || now() >= t.expiresAt) {
    delete tokens[did];
    return null;
  }
  return t;
}

function activeFor(did: string | null): boolean {
  return !!did && getToken(did) !== null;
}

function arm(did: string, targetNum: number | null, ttlMs = 1800, times = 3) {
  tokens[did] = {
    targetNum: typeof targetNum === 'number' && targetNum > 0 ? targetNum : null,
    left: Math.max(1, times),
    expiresAt: now() + Math.max(300, ttlMs),
  };
}

function consume(did: string) {
  const t = tokens[did];
  if (!t) return;
  t.left -= 1;
  if (t.left <= 0) {
    delete tokens[did];
  }
}

function isReplyJump(discussion: any, did: string, target: 'reply' | number | any): boolean {
  // 仅判断"发帖后滚动到底部/新楼"的特征
  if (!discussion) return false;

  if (target === 'reply') return true;

  const last: number | null =
    typeof discussion.lastPostNumber === 'function'
      ? discussion.lastPostNumber()
      : discussion.attribute?.('lastPostNumber');

  if (typeof target === 'number' && target > 0) {
    // 目标是"末楼或更后"（保守 ≥）
    if (typeof last === 'number' && last > 0 && target >= last) return true;
    // 若有 POST 返回的确切新楼号，用它作判定更稳
    const t = getToken(did);
    if (t?.targetNum && target >= t.targetNum) return true;
  }

  return false;
}

function installRequestHook() {
  // 只包一次
  if ((app as any).__lbReqHooked) return;
  (app as any).__lbReqHooked = true;

  const orig = app.request.bind(app);

  app.request = function (opts: any) {
    const p = orig(opts);
    try {
      const method = String(opts?.method || '').toUpperCase();
      const url = String(opts?.url || '');
      const isCreatePost =
        method === 'POST' &&
        /\/posts(?:\?|$|\/)/.test(url); // .../api/posts

      if (!isCreatePost) return p;

      return p.then((res: any) => {
        // 解析 discussionId 与新楼号
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
      // 出错不影响请求链路
      return p;
    }
  };
}

function installScrollGuards() {
  // --- goToNumber(entry)：最早的定位入口 ---
  const goToOrig = (PostStreamState as any).prototype.goToNumber;
  (PostStreamState as any).prototype.goToNumber = function (target: any, ...rest: any[]) {
    try {
      const discussion = (this as any)?.discussion;
      const did =
        discussion?.id?.() ??
        (typeof discussion?.id === 'function' ? discussion.id() : null);

      if (activeFor(did) && isReplyJump(discussion, did, target)) {
        consume(did);
        return; // 吞掉这一次"发帖后自动滚动"
      }
    } catch {}
    return goToOrig.apply(this, [target, ...rest]);
  };

  // --- PostStream.prototype.triggerScroll：滚动触发（适配不同核心版本） ---
  const psProto: any = (PostStream as any).prototype;

  if (typeof psProto.triggerScroll === 'function') {
    const trigOrig = psProto.triggerScroll;
    psProto.triggerScroll = function (...args: any[]) {
      try {
        const state = this?.attrs?.state;
        const discussion = state?.discussion;
        const did =
          discussion?.id?.() ??
          (typeof discussion?.id === 'function' ? discussion.id() : null);
        const target =
          state?.targetPostNumber ??
          state?.index ??
          (state?.visible && state.visible.number) ??
          null;

        if (activeFor(did) && isReplyJump(discussion, did, target)) {
          consume(did);
          return;
        }
      } catch {}
      return trigOrig.apply(this, args);
    };
  }

  // --- PostStream.prototype.scrollToNumber：另一实现路径 ---
  if (typeof psProto.scrollToNumber === 'function') {
    const toNumOrig = psProto.scrollToNumber;
    psProto.scrollToNumber = function (n: number, ...rest: any[]) {
      try {
        const state = this?.attrs?.state;
        const discussion = state?.discussion;
        const did =
          discussion?.id?.() ??
          (typeof discussion?.id === 'function' ? discussion.id() : null);

        if (activeFor(did) && isReplyJump(discussion, did, n)) {
          consume(did);
          return;
        }
      } catch {}
      return toNumOrig.apply(this, [n, ...rest]);
    };
  }

  // --- PostStream.prototype.scrollToIndex：极少数路径（保守） ---
  if (typeof psProto.scrollToIndex === 'function') {
    const toIdxOrig = psProto.scrollToIndex;
    psProto.scrollToIndex = function (i: number, ...rest: any[]) {
      try {
        const state = this?.attrs?.state;
        const discussion = state?.discussion;
        const did =
          discussion?.id?.() ??
          (typeof discussion?.id === 'function' ? discussion.id() : null);
        const approxTarget =
          state?.visible?.number && typeof state.visible.number === 'number'
            ? state.visible.number
            : i;

        if (activeFor(did) && isReplyJump(discussion, did, approxTarget)) {
          consume(did);
          return;
        }
      } catch {}
      return toIdxOrig.apply(this, [i, ...rest]);
    };
  }
}

export default function installReplyJumpInterceptor() {
  app.initializers.add('lady-byron/reading-enhance-reply-jump', () => {
    // 1) 监听“发帖成功”
    installRequestHook();

    // 2) 拦截“仅限由发帖引发的滚动”
    installScrollGuards();
  });
}
