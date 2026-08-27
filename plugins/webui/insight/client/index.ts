import type { Context } from "@koishi-ce/client";
import {} from "@koishi-ce/plugin-insight";
import Graph from "./index.vue";
import "./icons";

import "virtual:uno.css";

export default (ctx: Context) => {
	ctx.page({
		path: "/graph",
		name: "依赖图",
		icon: "activity:network",
		order: 550,
		fields: ["insight"],
		component: Graph,
	});
};
