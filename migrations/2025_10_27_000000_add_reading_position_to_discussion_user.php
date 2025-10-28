<?php

use Flarum\Database\Migration;
use Illuminate\Database\Schema\Blueprint;

return Migration::modifyTable('discussion_user', function (Blueprint $table) {
    // 迁移只会执行一次，无需 hasColumn 判定
    $table->unsignedInteger('lb_read_post_number')->nullable();
    $table->dateTime('lb_read_at')->nullable();
});
