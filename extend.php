<?php

use Flarum\Extend;
use Flarum\Api\Serializer\BasicDiscussionSerializer;
use Flarum\Api\Serializer\DiscussionSerializer;
use Flarum\Discussion\Discussion;
use Flarum\Discussion\UserState;

use LadyByron\ReadingEnhance\Api\Controller\SaveReadingPositionController;
use LadyByron\ReadingEnhance\Api\Controller\PingController;

return [
    // Forum 前端脚本
    (new Extend\Frontend('forum'))
        ->js(__DIR__.'/js/dist/forum.js'),

    // 类型映射（注意没有 date()，而是 cast datetime）
    (new Extend\Model(UserState::class))
        ->cast('lb_read_post_number', 'int')
        ->cast('lb_read_at', 'datetime'),

    // 把书签位随讨论返回
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

    // 仅保留：1) 主路由（POST）  2) 探针（GET）
    (new Extend\Routes('api'))
        ->post('/discussions/{id}/reading-position', 'ladybyron.reading-position.save', SaveReadingPositionController::class)
        ->get('/lb-ping', 'ladybyron.ping', PingController::class),
];
