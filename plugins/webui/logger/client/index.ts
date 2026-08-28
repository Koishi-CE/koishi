import type { Context } from "@koishi-ce/client";
import type { Message } from "reggol";
import Logs from "./index.vue";
import Settings from "./settings.vue";
import "./index.scss";
import "./icons";

import "virtual:uno.css";

// reggol v2 移除了 Logger.Record 类型别名,此处等价替代(与 logs.vue 一致)
interface LogRecord extends Message {
	id: number;
	timestamp: number;
	content: string;
}

// 浏览器端 tsconfig 无 paths,@koishi-ce/plugin-console 解析不到真实模块,
// Console.Services 来自 packages/web/client/client/shims.d.ts 的手写环境声明;
// 这里按同名环境声明合并为其补充 logs 键,使 ctx.page 的 fields 通过检查
declare module "@koishi-ce/plugin-console" {
	namespace Console {
		export interface Services {
			logs: DataService<LogRecord[]>;
		}
	}
}

export default (ctx: Context) => {
	ctx.page({
		path: "/logs",
		name: "日志",
		icon: "activity:logs",
		order: 0,
		authority: 4,
		fields: ["logs"],
		component: Logs,
	});

	ctx.slot({
		type: "plugin-details",
		component: Settings,
		order: -800,
	});
};
