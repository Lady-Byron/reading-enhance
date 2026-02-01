// js/src/forum/features/readingShortcuts.ts
import app from 'flarum/forum/app';

/**
 * 半屏/整屏翻页快捷键（桌面端优先）
 * - Shift+D  半屏下
 * - Shift+U  半屏上
 * - Shift+J  整屏下
 * - Shift+K  整屏上
 *
 * 仅在非输入/编辑状态触发；不影响弹窗、编辑器、Composer。
 */

type Options = {
  halfRatio: number;       // 半屏比例
  smooth: boolean;         // 是否平滑滚动
  headerSelector: string;  // 顶栏选择器，用于抵扣可视高度
};

const DEFAULTS: Options = {
  halfRatio: 0.5,
  smooth: true,
  headerSelector: '.App-header',
};

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t instanceof Element ? t : null;
  if (!el) return false;

  // 常见可编辑/输入容器
  const editable = el.closest(
    'input, textarea, [contenteditable="true"], .TextEditor, .CodeMirror, .ProseMirror, .Composer, .Modal'
  );
  // Composer 打开时整体禁用
  const composerOpen = !!(app as any)?.composer?.isVisible?.();

  return !!editable || composerOpen;
}

function headerOffsetPx(sel: string): number {
  try {
    const h = document.querySelector(sel);
    return h ? h.getBoundingClientRect().height : 0;
  } catch {
    return 0;
  }
}

function scrollByAmount(px: number, smooth: boolean) {
  if ('scrollBy' in window) {
    window.scrollBy({ top: px, left: 0, behavior: smooth ? 'smooth' : 'auto' });
  } else {
    const sc = document.scrollingElement || document.documentElement || document.body;
    sc.scrollTop += px;
  }
}

function keySig(e: KeyboardEvent): string {
  // 只关心 Shift + 字母，不处理 Ctrl/Meta/Alt，避免系统/浏览器冲突
  if (e.ctrlKey || e.metaKey || e.altKey) return '';
  const parts: string[] = [];
  if (e.shiftKey) parts.push('Shift');
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  parts.push(k);
  return parts.join('+');
}

export default function installReadingShortcuts(opts?: Partial<Options>) {
  const options: Options = Object.assign({}, DEFAULTS, opts || {});
  let attached = false;

  app.initializers.add('lady-byron/reading-enhance-shortcuts', () => {
    if (attached) return;
    attached = true;

    const onKeydown = (e: KeyboardEvent) => {
      // 在输入/编辑/弹窗内不触发；忽略按住不放的连发
      if (isEditableTarget(e.target) || e.repeat) return;

      const sig = keySig(e);
      if (!sig) return;

      const offset = headerOffsetPx(options.headerSelector);
      const vh = window.innerHeight || 0;

      switch (sig) {
        case 'Shift+D': {
          e.preventDefault(); e.stopPropagation();
          const delta = Math.max(1, Math.round(vh * options.halfRatio) - Math.round(offset / 2));
          scrollByAmount(delta, options.smooth);
          break;
        }
        case 'Shift+U': {
          e.preventDefault(); e.stopPropagation();
          const delta = Math.max(1, Math.round(vh * options.halfRatio) - Math.round(offset / 2));
          scrollByAmount(-delta, options.smooth);
          break;
        }
        case 'Shift+J': {
          e.preventDefault(); e.stopPropagation();
          // #2: 与 Shift+D/U 保持一致，扣除固定 header 高度，避免内容被遮挡
          const downDelta = Math.max(1, vh - offset);
          scrollByAmount(downDelta, options.smooth);
          break;
        }
        case 'Shift+K': {
          e.preventDefault(); e.stopPropagation();
          const upDelta = Math.max(1, vh - offset);
          scrollByAmount(-upDelta, options.smooth);
          break;
        }
        default:
          // 其它组合不处理
          break;
      }
    };

    // 捕获阶段优先处理，但不干扰其它键位
    window.addEventListener('keydown', onKeydown, true);

    // 若未来需要卸载，可暴露到全局（调试用）
    (window as any).__lb_shortcuts = {
      detach() {
        window.removeEventListener('keydown', onKeydown, true);
      },
    };
  });
}
