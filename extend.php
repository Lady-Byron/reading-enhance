<?php

namespace LadyByron\ReadingEnhance;

use Flarum\Discussion\Discussion;
use Flarum\Discussion\UserState;
use Flarum\Api\Serializer\BasicDiscussionSerializer;
use Flarum\Api\Serializer\DiscussionSerializer;
use Flarum\Extend;
use LadyByron\ReadingEnhance\Api\Controller\SaveReadingPositionController;

return [
    // 前端脚本
    (new Extend\Frontend('forum'))
        ->js(__DIR__.'/js/dist/forum.js'),

    // 数据库迁移
    (new Extend\Migrations())->add(__DIR__.'/migrations'),

    // 给 discussion_user 增加属性映射（model 层）
    (new Extend\Model(UserState::class))
        ->cast('lb_read_post_number', 'int')
        ->date('lb_read_at'),

    // 把阅读位置随讨论资源一并下发（两种 serializer 都加，确保首页/详情都能拿到）
    (new Extend\ApiSerializer(BasicDiscussionSerializer::class))
        ->attributes(function ($serializer, Discussion $discussion, array $attributes) {
            $state = $discussion->stateFor($serializer->getActor());
            $attributes['lbReadingPosition'] = $state?->lb_read_post_number ?: null;
            return $attributes;
        }),
    (new Extend\ApiSerializer(DiscussionSerializer::class))
        ->attributes(function ($serializer, Discussion $discussion, array $attributes) {
            $state = $discussion->stateFor($serializer->getActor());
            $attributes['lbReadingPosition'] = $state?->lb_read_post_number ?: null;
            return $attributes;
        }),

    // 提供保存阅读位置的 API
    (new Extend\Routes('api'))
        ->post('/discussions/{id}/reading-position', 'ladybyron.reading-position.save', SaveReadingPositionController::class),
];
