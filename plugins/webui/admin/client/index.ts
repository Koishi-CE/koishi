import { type Context, icons } from "@koishi-ce/client";
import {} from "@koishi-ce/plugin-admin";
import UserGroup from "./group.vue";
import Activity from "./icons/activity.vue";
import TrashCan from "./icons/trash-can.vue";

import "virtual:uno.css";

/**
 * 权限管理面板的浏览器侧入口：
 * 注册「权限管理」页面（用户组 / 用户组路线两组列表）并挂载所需图标。
 */
icons.register("trash-can", TrashCan);
icons.register("activity:group", Activity);

export default (ctx: Context) => {
	ctx.page({
		path: "/admin/:path*",
		name: "权限管理",
		icon: "activity:group",
		order: 400,
		authority: 4,
		component: UserGroup,
	});
};
