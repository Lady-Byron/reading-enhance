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

    // Eloquent 类型映射（不是迁移）
    (new Extend\Model(UserState::class))
        ->cast('lb_read_post_number', 'int')
        ->date('lb_read_at'),

    // 把书签位随讨论返回（列表与详情）
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

    // API 路由
    (new Extend\Routes('api'))

        // ① 读写书签位（原设计路径）——临时同时开放 GET 便于你在控制台验证命中情况
        ->get  ('/discussions/{id}/reading-position', 'ladybyron.reading-position.get',  SaveReadingPositionController::class)
        ->post ('/discussions/{id}/reading-position', 'ladybyron.reading-position.save', SaveReadingPositionController::class)
        ->patch('/discussions/{id}/reading-position', 'ladybyron.reading-position.save', SaveReadingPositionController::class)
        ->put  ('/discussions/{id}/reading-position', 'ladybyron.reading-position.save', SaveReadingPositionController::class)

        // ② 备用路径（规避极端匹配/代理差异）
        ->get  ('/ladybyron/reading-position/{id}', 'ladybyron.reading-position.alt.get',  SaveReadingPositionController::class)
        ->post ('/ladybyron/reading-position/{id}', 'ladybyron.reading-position.alt.save', SaveReadingPositionController::class)
        ->patch('/ladybyron/reading-position/{id}', 'ladybyron.reading-position.alt.save', SaveReadingPositionController::class)
        ->put  ('/ladybyron/reading-position/{id}', 'ladybyron.reading-position.alt.save', SaveReadingPositionController::class)

        // ③ 探针（PSR-15 控制器）
        ->get('/lb-ping', 'ladybyron.ping', PingController::class),
];
