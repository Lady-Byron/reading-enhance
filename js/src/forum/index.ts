import app from 'flarum/forum/app';
import Discussion from 'flarum/common/models/Discussion';
import Model from 'flarum/common/Model';

import installReplyJumpGuard from './features/ReplyJumpGuard';
import installReadingShortcuts from './features/KeyboardShortcuts';
import registerViewModifications from './extenders/ViewModifications';
import registerGlobalNavigation from './extenders/GlobalNavigation';

app.initializers.add('lady-byron/reading-enhance', () => {
  // 1. 注册 Model 属性 (让前端知道这个属性存在)
  Discussion.prototype.lbReadingPosition = Model.attribute('lbReadingPosition');

  // 2. 注册 UI 修改 (列表页链接 & 阅读页监听)
  registerViewModifications();

  // 3. 注册全局点击拦截 (实现任意链接续读)
  registerGlobalNavigation();

  // 4. 注册发帖防乱跳保护
  installReplyJumpGuard();

  // 5. 注册快捷键
  installReadingShortcuts();
});
