use Flarum\Extend;
use Flarum\Api\Serializer\BasicDiscussionSerializer;
use Flarum\Api\Serializer\DiscussionSerializer;
use Flarum\Discussion\Discussion;
use Flarum\Discussion\UserState;
use LadyByron\ReadingEnhance\Api\Controller\SaveReadingPositionController;

return [
    (new Extend\Frontend('forum'))
        ->js(__DIR__.'/js/dist/forum.js'),

    // 类型映射（可选但推荐）
    (new Extend\Model(UserState::class))
        ->cast('lb_read_post_number', 'int')
        ->date('lb_read_at'),

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

    // —— 路由：同时支持 POST 与 PATCH 到同一控制器 ——
    (new Extend\Routes('api'))
        ->post('/discussions/{id}/reading-position', 'ladybyron.reading-position.save', SaveReadingPositionController::class)
        ->patch('/discussions/{id}/reading-position', 'ladybyron.reading-position.save.patch', SaveReadingPositionController::class),
];
