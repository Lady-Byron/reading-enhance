<?php

use Flarum\Extend;
use Flarum\Api\Serializer\BasicDiscussionSerializer;
use Flarum\Api\Serializer\DiscussionSerializer;
use Flarum\Discussion\Discussion;
use LadyByron\ReadingEnhance\Api\Controller\SaveReadingPositionController;

return [
    // 仅注入 forum 端脚本
    (new Extend\Frontend('forum'))
        ->js(__DIR__.'/js/dist/forum.js'),

    // 在两种讨论序列化器上都附加我们自己的字段（避免首页卡片拿不到）
    (new Extend\ApiSerializer(BasicDiscussionSerializer::class))
        ->attributes(function ($serializer, $discussion, array $attributes) {
            // 不做严格类型提示，避免某些旧版本解析期报错
            $state = $discussion->stateFor($serializer->getActor());
            $attributes['lbReadingPosition'] = $state ? $state->lb_read_post_number : null;
            return $attributes;
        }),

    (new Extend\ApiSerializer(DiscussionSerializer::class))
        ->attributes(function ($serializer, $discussion, array $attributes) {
            $state = $discussion->stateFor($serializer->getActor());
            $attributes['lbReadingPosition'] = $state ? $state->lb_read_post_number : null;
            return $attributes;
        }),

    // API 路由：同时支持 POST / PATCH
    (new Extend\Routes('api'))
        ->post('/discussions/{id}/reading-position',  'ladybyron.reading-position.save',       SaveReadingPositionController::class)
        ->patch('/discussions/{id}/reading-position', 'ladybyron.reading-position.save.patch', SaveReadingPositionController::class),
];
