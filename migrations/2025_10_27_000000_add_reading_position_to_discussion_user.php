<?php

use Flarum\Database\Migration;
use Illuminate\Database\Schema\Blueprint;

return Migration::modifyTables([
    'discussion_user' => function (Blueprint $table) {
        if (! $table->hasColumn('lb_read_post_number')) {
            $table->unsignedInteger('lb_read_post_number')->nullable()->after('last_read_post_number');
        }
        if (! $table->hasColumn('lb_read_at')) {
            $table->dateTime('lb_read_at')->nullable()->after('lb_read_post_number');
        }
        // 可按需加索引：$table->index(['user_id','discussion_id','lb_read_post_number']);
    },
]);
