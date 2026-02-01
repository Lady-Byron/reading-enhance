<?php

use Flarum\Extend;
use Flarum\Api\Serializer\BasicDiscussionSerializer;
use Flarum\Discussion\Discussion;
use Flarum\Discussion\UserState;

use LadyByron\ReadingEnhance\Api\Controller\SaveReadingPositionController;
use LadyByron\ReadingEnhance\Api\Controller\PingController;

return [
    // 注入 forum 端前端脚本
    (new Extend\Frontend('forum'))
        ->js(__DIR__.'/js/dist/forum.js'),

    // Eloquent 类型映射
    (new Extend\Model(UserState::class))
        ->cast('lb_read_post_number', 'int')
        ->cast('lb_read_at', 'datetime'),

    // 序列化时带上阅读位置字段
    // 只注册在 BasicDiscussionSerializer 上；DiscussionSerializer 继承自它，
    // Flarum 的 instanceof 检查会让两者都执行此回调，无需重复注册
    (new Extend\ApiSerializer(BasicDiscussionSerializer::class))
        ->attributes(function ($serializer, Discussion $discussion, array $attributes) {
            $state = $discussion->stateFor($serializer->getActor());
            $attributes['lbReadingPosition'] = $state?->lb_read_post_number ?? null;
            return $attributes;
        }),

    // 路由：仅 2 条（主路由 + 探针），主路由不带路径参数，id 改从 body 读
    (new Extend\Routes('api'))
        ->post('/ladybyron/reading-position', 'ladybyron.lb-reading-position.save', SaveReadingPositionController::class)
        ->get('/lb-ping', 'ladybyron.ping', PingController::class),
];
