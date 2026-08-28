/**
 * 设置插件：
 * - 注册用户设置页（/settings/:name*，活动栏底部）；
 * - 注册 role 为 "theme" 的字符串 schema 渲染组件（主题选择器）；
 * - 声明 "status"（状态栏设置）设置分组，供其它扩展挂载配置项。
 */

import type { Context } from "@koishi-ce/client";
import Settings from "./settings.vue";
import Theme from "./theme.vue";

export default function (ctx: Context) {
	ctx.page({
		path: "/settings/:name*",
		name: "用户设置",
		icon: "activity:settings",
		position: "bottom",
		order: -100,
		component: Settings,
	});

	ctx.schema({
		type: "string",
		role: "theme",
		component: Theme,
	});

	ctx.settings({
		id: "status",
		title: "状态栏设置",
		order: 800,
	});

	// ctx.settings({
	//   id: 'activity',
	//   title: '活动栏设置',
	//   order: 800,
	// })
}
