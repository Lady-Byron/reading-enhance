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
    /** @var string */
    public $serializer = DiscussionSerializer::class;

    public function __construct(
        protected DiscussionRepository $discussions
    ) {}

    protected function data(ServerRequestInterface $request, Document $document)
    {
        $actor = RequestUtil::getActor($request);
        $actor->assertRegistered();

        // 路径参数 {id} 应该通过 getAttribute('id') 获取
        $discussionId = $request->getAttribute('id');

        $discussion = $this->discussions->findOrFail($discussionId, $actor);

        $body = (array) $request->getParsedBody();

        // 支持两种载荷：{ postNumber: 123 } 或 JSON:API 的 data.attributes.postNumber
        $number = (int) (Arr::get($body, 'postNumber')
            ?? Arr::get($body, 'data.attributes.postNumber'));

        if ($number > 0) {
            $state = $discussion->stateFor($actor);
            $state->lb_read_post_number = $number; // “最后一次稳定停留楼层”
            $state->lb_read_at = now();
            $state->save(); // 不影响核心 last_read_post_number
        }

        // 返回讨论资源（包含我们在 Serializer 里扩展的 lbReadingPosition）
        return $discussion;
    }
}

