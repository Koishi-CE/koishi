/**
 * 首页插件：将 welcome 欢迎页注册为根路由 "/"。
 * order 取极大值（活动栏 top 组渲染时按 order 逆序输出，故首页位于最顶部）。
 */

import type { Context } from "@koishi-ce/client";
import Home from "./home.vue";

export default function (ctx: Context) {
	ctx.page({
		id: "home",
		path: "/",
		name: "欢迎",
		icon: "activity:home",
		order: 1000,
		component: Home,
	});
}
