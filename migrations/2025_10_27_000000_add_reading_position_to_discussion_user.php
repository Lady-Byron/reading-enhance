<?php

use Flarum\Database\Migration;

return Migration::addColumns('discussion_user', [
    // Flarum 会自动加上表前缀（如 flarum_discussion_user），这里不要写前缀
    'lb_read_post_number' => ['integer', 'unsigned' => true, 'nullable' => true],
    'lb_read_at'          => ['dateTime', 'nullable' => true],
]);
