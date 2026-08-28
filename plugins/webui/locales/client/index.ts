import { type Context, icons } from "@koishi-ce/client";
import type { Dict, I18n } from "@koishi-ce/koishi";
import {} from "@koishi-ce/plugin-locales";
import Activity from "./icons/activity.vue";
import Globe from "./icons/globe.vue";
import Locales from "./locales.vue";

import "virtual:uno.css";

// 浏览器端 tsconfig 无 paths,@koishi-ce/plugin-console 解析不到真实模块,
// Console.Services 来自 packages/web/client/client/shims.d.ts 的手写环境声明;
// 这里按同名环境声明合并为其补充 locales 键,使 ctx.page 的 fields 通过检查
// (DataService 同样解析自该环境声明,与 insight 客户端的做法保持一致)
declare module "@koishi-ce/plugin-console" {
	namespace Console {
		export interface Services {
			locales: DataService<Dict<I18n.Store>>;
		}
	}
}

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
