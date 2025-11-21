// js/src/forum/index.ts
import installReplyJumpInterceptor from './features/replyJumpInterceptor';
import installReadingShortcuts from './features/readingShortcuts';
import installReadingPositionRecorder from './features/readingPositionRecorder';
import installDiscussionNavigation from './features/discussionNavigation';

// 纯入口：只负责注册各模块的 initializer
installReplyJumpInterceptor();
installReadingShortcuts();
installReadingPositionRecorder();
installDiscussionNavigation();
