/**
 * 机器人状态灯组件注册：将状态栏右侧的机器人概况视图挂到 status-right 插槽位。
 */
import type { Context } from "@koishi-ce/client";
import Bots from "./index.vue";

export default (ctx: Context) => {
	ctx.slot({
		type: "status-right",
		component: Bots,
	});
};
