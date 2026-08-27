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
