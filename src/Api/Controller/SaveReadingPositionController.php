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

        // 路由参数 {id:[0-9]+} 已在 extend.php 约束为数字
        $discussionId = (int) $request->getAttribute('id');

        // 解析请求体
        $body   = (array) $request->getParsedBody();
        $number = Arr::get($body, 'postNumber')
            ?? Arr::get($body, 'data.attributes.postNumber');
        $number = $number !== null ? (int) $number : null;

        // 找讨论（id 无效会抛 404，符合预期）
        $discussion = $this->discussions->findOrFail($discussionId, $actor);

        // 仅当提供了合法 postNumber 时才写入
        if ($number !== null && $number > 0) {
            $state = $discussion->stateFor($actor);
            $state->lb_read_post_number = $number;
            $state->lb_read_at = \Illuminate\Support\Carbon::now();
            $state->save();
        }

        // 返回讨论资源（含我们扩展的 lbReadingPosition）
        return $discussion;
    }
}
