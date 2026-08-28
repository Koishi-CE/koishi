/**
 * 状态栏插件：向全局 "status" 插槽注册状态栏主体（可悬停出 tooltip 的
 * 状态项容器），并向 "status-right" 插槽注册页面组件加载进度条。
 */

import type { Context } from "@koishi-ce/client";
import Loading from "./loading.vue";
import Status from "./status.vue";

export default function (ctx: Context) {
	ctx.slot({
		type: "status",
		component: Status,
		order: -1000,
	});

	ctx.slot({
		type: "status-right",
		component: Loading,
	});
}
