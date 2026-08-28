import { type Context, icons } from "@koishi-ce/client";
import {} from "@koishi-ce/plugin-commands";
import Commands from "./commands.vue";
import Activity from "./icons/activity.vue";
import Check from "./icons/check.vue";
import TrashCan from "./icons/trash-can.vue";
import Locales from "./locales.vue";
import Settings from "./settings.vue";

import "virtual:uno.css";

/**
 * 指令管理面板的浏览器侧入口：
 * 注册「指令管理」页面、插件详情页的指令列表插槽、
 * 本地化页面的跳转插槽，以及页面顶部的操作菜单（保存 / 移除 / 创建）。
 */
icons.register("activity:commands", Activity);
icons.register("check", Check);
icons.register("trash-can", TrashCan);

export default (ctx: Context) => {
	ctx.page({
		path: "/commands/:name*",
		name: "指令管理",
		icon: "activity:commands",
		order: 500,
		authority: 4,
		component: Commands,
	});

	ctx.slot({
		type: "plugin-details",
		component: Settings,
		order: 200,
	});

	ctx.slot({
		type: "locale-main",
		component: Locales,
		order: 1000,
	});

	ctx.menu("command", [
		{
			id: ".update",
			icon: "save",
			label: "保存更改",
		},
		{
			id: ".remove",
			icon: "trash-can",
			label: "移除指令",
		},
		{
			id: ".create",
			icon: "add",
			label: "创建指令",
		},
	]);
};
