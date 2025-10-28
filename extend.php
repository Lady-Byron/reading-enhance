<?php

use Flarum\Extend;
use Flarum\Api\Serializer\BasicDiscussionSerializer;
use Flarum\Api\Serializer\DiscussionSerializer;
use Flarum\Discussion\Discussion;
use Flarum\Discussion\UserState;

use LadyByron\ReadingEnhance\Api\Controller\SaveReadingPositionController;

return [
    // forum 端前端脚本
    (new Extend\Frontend('forum'))
        ->js(__DIR__.'/js/dist/forum.js'),

    // Eloquent 类型映射（注意：没有 ->date()；用 cast datetime）
    (new Extend\Model(UserState::class))
        ->cast('lb_read_post_number', 'int')
        ->cast('lb_read_at', 'datetime'),

    // 把阅读位置随讨论资源一并下发（列表 & 详情）
    (new Extend\ApiSerializer(BasicDiscussionSerializer::class))
        ->attributes(function ($serializer, Discussion $discussion, array $attributes) {
            $state = $discussion->stateFor($serializer->getActor());
            $attributes['lbReadingPosition'] = $state?->lb_read_post_number ?? null;
            return $attributes;
        }),

    (new Extend\ApiSerializer(DiscussionSerializer::class))
        ->attributes(function ($serializer, Discussion $discussion, array $attributes) {
            $state = $discussion->stateFor($serializer->getActor());
            $attributes['lbReadingPosition'] = $state?->lb_read_post_number ?? null;
            return $attributes;
        }),

    // ✅ 使用独立命名空间的 API 路由，避开 /discussions/{id}/{relationship} 冲突
    (new Extend\Routes('api'))
        ->post('/ladybyron/reading-position/{id:[0-9]+}', 'ladybyron.lb-reading-position.save', SaveReadingPositionController::class),
];
