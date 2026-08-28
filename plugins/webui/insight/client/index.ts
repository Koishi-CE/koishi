import type { Context } from "@koishi-ce/client";
import type Insight from "@koishi-ce/plugin-insight";
import Graph from "./index.vue";
import "./icons";

import "virtual:uno.css";

// 浏览器端 tsconfig 无 paths,@koishi-ce/plugin-console 解析不到真实模块,
// Console.Services 来自 packages/web/client/client/shims.d.ts 的手写环境声明;
// 这里按同名环境声明合并为其补充 insight 键,使 ctx.page 的 fields 通过检查
declare module "@koishi-ce/plugin-console" {
	namespace Console {
		export interface Services {
			insight: DataService<Insight.Payload>;
		}
	}
}

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
