<?php

use Flarum\Extend;
use Flarum\Api\Serializer\BasicDiscussionSerializer;
use Flarum\Api\Serializer\DiscussionSerializer;
use Flarum\Discussion\Discussion;
use LadyByron\ReadingEnhance\Api\Controller\SaveReadingPositionController;

return [
    // 前端（论坛端）脚本
    (new Extend\Frontend('forum'))
        ->js(__DIR__.'/js/dist/forum.js'),

    // 将阅读位置随讨论返回（首页摘要 & 详情）
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

    // 保存阅读位置的 API 路由
    (new Extend\Routes('api'))
        ->post('/discussions/{id}/reading-position', 'ladybyron.reading-position.save', SaveReadingPositionController::class),
];
