import app from 'flarum/forum/app';

const DEFAULTS = {
  halfRatio: 0.5,
  smooth: true,
  headerSelector: '.App-header', // Flarum 默认顶栏 Class
};

function isEditableTarget(e: EventTarget | null): boolean {
  if (!(e instanceof Element)) return false;
  return !!e.closest('input, textarea, [contenteditable="true"], .TextEditor, .Composer, .Modal');
}

function scrollByAmount(px: number) {
  window.scrollBy({ top: px, left: 0, behavior: 'smooth' });
}

export default function installReadingShortcuts() {
  // [Debug] 确认模块是否加载
  console.log('[LadyByron] Shortcuts module loaded');

  window.addEventListener('keydown', (e) => {
    // 忽略输入状态、组合键
    if (isEditableTarget(e.target) || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    
    if (!e.shiftKey) return;

    const key = e.key.toUpperCase();
    // [Debug] 确认按键被捕获
    // console.log('[LadyByron] Key pressed:', key);

    const vh = window.innerHeight;
    const headerEl = document.querySelector(DEFAULTS.headerSelector);
    const headerH = headerEl ? headerEl.getBoundingClientRect().height : 0;
    const half = Math.max(1, Math.round(vh * DEFAULTS.halfRatio) - Math.round(headerH / 2));

    let handled = false;

    switch (key) {
      case 'D': // Shift + D
        scrollByAmount(half);
        handled = true;
        break;
      case 'U': // Shift + U
        scrollByAmount(-half);
        handled = true;
        break;
      case 'J': // Shift + J
        scrollByAmount(vh);
        handled = true;
        break;
      case 'K': // Shift + K
        scrollByAmount(-vh);
        handled = true;
        break;
    }

    if (handled) {
      console.log('[LadyByron] Shortcut triggered:', key);
      e.preventDefault();
      e.stopPropagation();
    }
  }, true); // Capture phase
}
