<?php

namespace LadyByron\ReadingEnhance\Api\Controller;

use Flarum\Api\Controller\AbstractShowController;
use Flarum\Api\Serializer\DiscussionSerializer;
use Flarum\Discussion\DiscussionRepository;
use Flarum\Http\RequestUtil;
use Illuminate\Support\Arr;
use Laminas\Diactoros\Response\JsonResponse;
use Psr\Http\Message\ServerRequestInterface;
use Tobscure\JsonApi\Document;

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

        // 路由参数（受 extend.php 的 {id:[0-9]+} 约束，确保是数字字符串）
        $discussionId = $request->getAttribute('id');

        // 解析请求体
        $body = (array) $request->getParsedBody();
        $debug = (bool) (Arr::get($body, 'debug') ?? false);
        $number = Arr::get($body, 'postNumber')
            ?? Arr::get($body, 'data.attributes.postNumber');
        $number = $number !== null ? (int) $number : null;

        // --- 可选 Debug：仅当传入 {"debug":true} 时，回显我们拿到的参数，证明是否命中了控制器 & 取到了 id ---
        if ($debug) {
            return new JsonResponse([
                'route_hit'   => true,
                'method'      => $request->getMethod(),
                'id_attr'     => $discussionId,
                'actor_id'    => $actor->id,
                'post_number' => $number,
            ]);
        }
        // --- /Debug ---

        // 严格校验
        if (!$discussionId || !ctype_digit((string)$discussionId)) {
            // 参数无效：返回 422，避免误判为 404
            return new JsonResponse(['errors' => [['status' => '422', 'code' => 'invalid_id']]], 422);
        }
        if ($number === null || $number <= 0) {
            return new JsonResponse(['errors' => [['status' => '422', 'code' => 'invalid_post_number']]], 422);
        }

        // 权限 + 存储
        $discussion = $this->discussions->findOrFail((int) $discussionId, $actor);

        $state = $discussion->stateFor($actor);
        $state->lb_read_post_number = $number;  // “最后一次稳定停留楼层”
        $state->lb_read_at = now();
        $state->save();

        // 返回讨论资源（含我们扩展的 lbReadingPosition）
        return $discussion;
    }
}

