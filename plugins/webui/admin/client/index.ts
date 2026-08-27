import { type Context, icons } from "@koishi-ce/client";
import {} from "@koishi-ce/plugin-admin";
import UserGroup from "./group.vue";
import Activity from "./icons/activity.vue";
import TrashCan from "./icons/trash-can.vue";

import "virtual:uno.css";

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
