<?php

namespace LadyByron\ReadingEnhance\Api\Controller;

use Flarum\Api\Controller\AbstractShowController;
use Flarum\Api\Serializer\DiscussionSerializer;
use Flarum\Discussion\DiscussionRepository;
use Flarum\Foundation\ValidationException;
use Flarum\Http\RequestUtil;
use Illuminate\Support\Arr;
use Illuminate\Support\Carbon;
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

        $discussionId = Arr::get($body, 'discussionId')
            ?? Arr::get($body, 'data.attributes.discussionId');
        $postNumber = Arr::get($body, 'postNumber')
            ?? Arr::get($body, 'data.attributes.postNumber');

        $discussionId = $discussionId !== null ? (int) $discussionId : null;
        $postNumber   = $postNumber   !== null ? (int) $postNumber   : null;

        // #1: 参数校验 — 抛出 ValidationException 返回标准 422
        if (!$discussionId || $discussionId <= 0) {
            throw new ValidationException(['discussionId' => 'Invalid discussion ID.']);
        }

        if (!$postNumber || $postNumber <= 0) {
            throw new ValidationException(['postNumber' => 'Invalid post number.']);
        }

        $discussion = $this->discussions->findOrFail($discussionId, $actor);

        // #7: postNumber 不得超过讨论的实际帖子数
        $lastPostNumber = $discussion->last_post_number;
        if ($lastPostNumber && $postNumber > $lastPostNumber) {
            $postNumber = $lastPostNumber;
        }

        $state = $discussion->stateFor($actor);
        $now = Carbon::now();

        // #6: 简易限流 — 同一讨论 1 秒内不重复写入
        if ($state->lb_read_at instanceof Carbon && $now->diffInSeconds($state->lb_read_at) < 1) {
            return $discussion;
        }

        $state->lb_read_post_number = $postNumber;
        $state->lb_read_at = $now;
        $state->save();

        return $discussion;
    }
}
