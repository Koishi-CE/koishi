import { type Context, icons } from "@koishi-ce/client";
import {} from "@koishi-ce/plugin-locales";
import Activity from "./icons/activity.vue";
import Globe from "./icons/globe.vue";
import Locales from "./locales.vue";

import "virtual:uno.css";

icons.register("activity:locales", Activity);
icons.register("globe", Globe);

export default (ctx: Context) => {
	ctx.page({
		path: "/locales/:path*",
		name: "本地化",
		icon: "activity:locales",
		order: 450,
		authority: 4,
		fields: ["locales"],
		component: Locales,
	});
};
