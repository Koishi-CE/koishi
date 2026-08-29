/**
 * console 宿主插件（浏览器环境变体，BrowserConsole）。
 *
 * 供控制台前端自身在浏览器里运行时使用（区别于 node 侧的 NodeConsole）：
 * 复用同一套基类，但通信 socket 来自 loader 挂载的
 * `Symbol.for("koishi.socket")` 全局约定，entry 也只取生产产物。
 */

import type { IncomingMessage } from "node:http";
import { Console, type Entry } from "@koishi-ce/console";
import { makeArray, Schema } from "@koishi-ce/koishi";
import type {} from "@koishi-ce/loader";

export * from "@koishi-ce/console";

class BrowserConsole extends Console {
	static Config: Schema<BrowserConsole.Config> = Schema.object({});

	/**
	 * 接入 loader 提供的 WebSocket（浏览器宿主的通信通道，
	 * 与 NodeConsole 自行建立 server 层的方式不同）。
	 */
	override start() {
		// 浏览器宿主在 loader 上挂载的 socket 是运行时约定，仅以全局 symbol 注册表键存在，
		// 无法在 Loader 类型上声明（Symbol.for 的返回值不是 unique symbol，不能用作接口键）
		// @ts-expect-error koishi.socket symbol 索引不在 Loader 类型定义中
		const socket = this.ctx.loader[Symbol.for("koishi.socket")];
		// 浏览器宿主没有 HTTP 升级请求，构造仅含空 headers 的壳对象以满足 Client.request 形状
		this.accept(socket, { headers: {} } as unknown as IncomingMessage);
	}

	/** 解析 entry 产物：浏览器宿主无开发模式，统一取生产文件列表。 */
	override resolveEntry(files: Entry.Files) {
		if (typeof files === "string" || Array.isArray(files))
			return makeArray(files);
		return makeArray(files.prod);
	}
}

// erasableSyntaxOnly 禁止含运行时值的 namespace：Config 常量改挂为类的静态属性
// （BrowserConsole.Config 的取值不变），namespace 仅保留类型声明以维持类型访问
namespace BrowserConsole {
	/** 插件配置类型（当前无可用配置项）。 */
	export type Config = Record<never, never>;
}

export default BrowserConsole;
