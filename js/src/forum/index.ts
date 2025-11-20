// js/src/forum/index.ts
import app from 'flarum/forum/app';

// 导入我们拆分出来的三个功能模块
import installReplyJumpInterceptor from './features/replyJumpInterceptor';
import installReadingShortcuts from './features/readingShortcuts';
import installSmartJump from './features/smartJump'; // 这是刚才新建的核心逻辑文件

app.initializers.add('lady-byron/reading-enhance', () => {
  // 1. 安装“发帖后自动跳尾抑制” (原有功能，已模块化)
  installReplyJumpInterceptor();

  // 2. 安装“阅读快捷键：Shift+D/U/J/K” (原有功能，已模块化)
  installReadingShortcuts();

  // 3. 安装“智能跳转” (新功能：视口预加载 + 点击拦截 + 加载UI)
  // 注意：这里不再有原来的 mouseover 逻辑，全部移交给 smartJump 处理了
  installSmartJump();
});
