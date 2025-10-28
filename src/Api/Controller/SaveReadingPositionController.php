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
        $discussionId = $request->getAttribute('id');

        $body   = (array) $request->getParsedBody();
        $debug  = (bool) (Arr::get($body, 'debug') ?? false);
        $number = Arr::get($body, 'postNumber')
            ?? Arr::get($body, 'data.attributes.postNumber');
        $number = $number !== null ? (int) $number : null;

        // 找讨论（这里如果 id 不存在会抛 404，符合预期）
        $discussion = $this->discussions->findOrFail((int) $discussionId, $actor);

        // 调试信息放到 JSON:API 的 meta，不改变返回资源类型
        if ($debug) {
            $document->setMeta([
                'route_hit'   => true,
                'method'      => $request->getMethod(),
                'id_attr'     => $discussionId,
                'actor_id'    => $actor->id,
                'post_number' => $number,
            ]);
        }

        // 正常写入（仅当提供了合法的 postNumber）
        if ($number !== null && $number > 0) {
            $state = $discussion->stateFor($actor);
            $state->lb_read_post_number = $number;
            $state->lb_read_at = now(); // 或 \Illuminate\Support\Carbon::now()
            $state->save();
        }

        // 返回讨论资源（交给 DiscussionSerializer 序列化）
        return $discussion;
    }
}
