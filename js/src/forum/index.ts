// js/src/forum/index.ts
import app from 'flarum/forum/app';
import Discussion from 'flarum/common/models/Discussion';
import Model from 'flarum/common/Model';

import installReplyJumpGuard from './features/ReplyJumpGuard';
import installReadingShortcuts from './features/KeyboardShortcuts'; // 保持你原有的文件内容即可
import registerViewModifications from './extenders/ViewModifications';
import registerGlobalNavigation from './extenders/GlobalNavigation'; // 下面会给出一个简化版

app.initializers.add('lady-byron/reading-enhance', () => {
  // 注册 Model 属性，让 TS 不报错
  Discussion.prototype.lbReadingPosition = Model.attribute('lbReadingPosition');

  // 安装功能
  installReplyJumpGuard();
  installReadingShortcuts(); // 这个文件不需要大改，只要去掉 @ts-ignore 稍微规范下即可
  
  // 注册 UI 修改
  registerViewModifications();
  
  // 注册全局点击接管 (简化版，去除 mouseover)
  registerGlobalNavigation();
});
