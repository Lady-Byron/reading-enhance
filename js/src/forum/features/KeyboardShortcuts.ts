import app from 'flarum/forum/app';

const DEFAULTS = {
  halfRatio: 0.5,
  smooth: true,
  headerSelector: '.App-header',
};

function isEditableTarget(e: EventTarget | null): boolean {
  if (!(e instanceof Element)) return false;
  // 避免在输入框、编辑器、弹窗中触发
  return !!e.closest('input, textarea, [contenteditable="true"], .TextEditor, .Composer, .Modal');
}

function scrollByAmount(px: number) {
  window.scrollBy({ top: px, left: 0, behavior: 'smooth' });
}

export default function installReadingShortcuts() {
  let attached = false;

  app.initializers.add('lady-byron/reading-shortcuts', () => {
    if (attached) return;
    attached = true;

    window.addEventListener('keydown', (e) => {
      // 忽略输入状态、组合键(Ctrl/Alt)
      if (isEditableTarget(e.target) || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      
      if (!e.shiftKey) return; // 必须按 Shift

      const key = e.key.toUpperCase();
      const vh = window.innerHeight;
      const headerH = document.querySelector(DEFAULTS.headerSelector)?.getBoundingClientRect().height || 0;
      const half = Math.max(1, Math.round(vh * DEFAULTS.halfRatio) - Math.round(headerH / 2));

      let handled = false;

      switch (key) {
        case 'D': // Shift + D (下半屏)
          scrollByAmount(half);
          handled = true;
          break;
        case 'U': // Shift + U (上半屏)
          scrollByAmount(-half);
          handled = true;
          break;
        case 'J': // Shift + J (下一屏)
          scrollByAmount(vh);
          handled = true;
          break;
        case 'K': // Shift + K (上一屏)
          scrollByAmount(-vh);
          handled = true;
          break;
      }

      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true); // Capture phase
  });
}
