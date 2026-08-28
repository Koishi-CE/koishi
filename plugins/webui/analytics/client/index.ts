import type { Context } from "@koishi-ce/client";
import type Analytics from "@koishi-ce/plugin-analytics";

// 浏览器端 tsconfig 无 paths,@koishi-ce/plugin-console 解析不到真实模块,
// Console.Services 来自 packages/web/client/client/shims.d.ts 的手写环境声明;
// 这里按同名环境声明合并为其补充 analytics 键,使 fields/store 通过检查
// (Store 由 Services 的 DataService<T> 映射而来,一并生效)
declare module "@koishi-ce/plugin-console" {
	namespace Console {
		export interface Services {
			analytics: DataService<Analytics.Payload>;
		}
	}
}

import Charts from "./charts";
import Home from "./home.vue";
import "./icons";

import "virtual:uno.css";

export default (ctx: Context) => {
	// ctx.app.provide('ecTheme', 'koishi-dark')
	ctx.plugin(Charts);

	ctx.slot({
		type: "home",
		component: Home,
		order: 0,
	});
};
