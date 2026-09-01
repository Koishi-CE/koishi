// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * CPU / 内存负载组件注册：将负载概况视图挂到状态栏右侧的 status-right 插槽位。
 */
import type { Context } from "@koishi-ce/client";
import Load from "./index.vue";

export default (ctx: Context) => {
	ctx.slot({
		type: "status-right",
		component: Load,
	});
};
