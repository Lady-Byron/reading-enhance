<?php

namespace LadyByron\ReadingEnhance\Api\Controller;

use Flarum\Api\Controller\AbstractShowController;
use Flarum\Api\Serializer\DiscussionSerializer;
use Flarum\Discussion\DiscussionRepository;
use Flarum\Http\RequestUtil;
use Illuminate\Support\Arr;
use Tobscure\JsonApi\Document;
use Psr\Http\Message\ServerRequestInterface;

class SaveReadingPositionController extends AbstractShowController
{
    /** @var string */
    public $serializer = DiscussionSerializer::class;

    public function __construct(protected DiscussionRepository $discussions)
    {
    }

    protected function data(ServerRequestInterface $request, Document $document)
    {
        $actor = RequestUtil::getActor($request);
        $actor->assertRegistered();

        $body = (array) $request->getParsedBody();

        // 从 body 读取 discussionId 与 postNumber（不再依赖路径参数）
        $discussionId = Arr::get($body, 'discussionId')
            ?? Arr::get($body, 'data.attributes.discussionId');
        $postNumber = Arr::get($body, 'postNumber')
            ?? Arr::get($body, 'data.attributes.postNumber');

        $discussionId = $discussionId !== null ? (int) $discussionId : null;
        $postNumber   = $postNumber   !== null ? (int) $postNumber   : null;

        if (!$discussionId || $discussionId <= 0) {
            // 422：参数无效
            $document->setMeta(['error' => 'invalid_discussion_id']);
            return null;
        }

        $discussion = $this->discussions->findOrFail($discussionId, $actor);

        if ($postNumber !== null && $postNumber > 0) {
            $state = $discussion->stateFor($actor);
            $state->lb_read_post_number = $postNumber;
            $state->lb_read_at = \Illuminate\Support\Carbon::now();
            $state->save();
        } else {
            // 不写入，仅返回讨论，方便前端探测
            $document->setMeta(['note' => 'no_postNumber_provided']);
        }

        return $discussion;
    }
}

