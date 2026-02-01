<?php

namespace LadyByron\ReadingEnhance\Api\Controller;

use Laminas\Diactoros\Response\JsonResponse;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * 健康探针端点，无需认证。
 * 仅用于前端/运维探测 API 可达性，返回固定 JSON，不暴露敏感信息。
 */
class PingController implements RequestHandlerInterface
{
    public function handle(ServerRequestInterface $request): ResponseInterface
    {
        return new JsonResponse(['ok' => true, 'ts' => time()]);
    }
}
