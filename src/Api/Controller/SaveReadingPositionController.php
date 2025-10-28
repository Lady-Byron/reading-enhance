<?php

namespace LadyByron\ReadingEnhance\Api\Controller;

use Flarum\Api\Controller\AbstractShowController;
use Flarum\Api\Serializer\DiscussionSerializer;
use Flarum\Discussion\DiscussionRepository;
use Flarum\Http\RequestUtil;
use Illuminate\Support\Arr;
use Psr\Http\Message\ServerRequestInterface;
use Tobscure\JsonApi\Document;

class SaveReadingPositionController extends AbstractShowController
{
    public $serializer = DiscussionSerializer::class;

    protected DiscussionRepository $discussions;

    public function __construct(DiscussionRepository $discussions)
    {
        $this->discussions = $discussions;
    }

    protected function data(ServerRequestInterface $request, Document $document)
    {
        $actor = RequestUtil::getActor($request);
        $actor->assertRegistered(); // 必须登录

        $discussionId = Arr::get($request->getQueryParams(), 'id');
        $discussion = $this->discussions->findOrFail($discussionId, $actor);

        $body = (array) $request->getParsedBody();
        // 允许 JSON:API 风格或简洁风格
        $number = (int) (Arr::get($body, 'postNumber')
            ?? Arr::get($body, 'data.attributes.postNumber'));

        if ($number > 0) {
            $state = $discussion->stateFor($actor);
            // “始终记录最后一次稳定停留楼层”，允许上/下移动
            $state->lb_read_post_number = $number;
            $state->lb_read_at = now();
            $state->save();
        }

        // 返回讨论资源（含我们在 serializer 里加的 lbReadingPosition）
        return $discussion;
    }
}
