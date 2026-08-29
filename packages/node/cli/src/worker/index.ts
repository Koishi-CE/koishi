/**
 * worker 子进程入口：真正启动 Koishi 应用的地方。
 *
 * 由 CLI 守护进程（src/cli/start.ts）通过 Bun.spawn 拉起。流程为：
 * 初始化 Loader 并读取配置文件 → 应用日志配置 → 应用时区与堆栈深度设置 →
 * 创建应用上下文 → 挂载 daemon 插件 → 启动。未捕获异常将以错误码 1 退出，
 * 由父进程依据退出码决定是否重启。
 */

import { Context, type Dict, Logger, Schema, Time } from "@koishi-ce/core";
import Loader from "@koishi-ce/loader";
import * as daemon from "./daemon";
import * as logger from "./logger";

// 以相对导入 re-export 包主入口（上游同款写法）：worker 产物本身属于本包，
// 若写包名自引用，作为 main entry 直接执行时会触发 Bun 的自引用解析问题
// （进程静默退出）；相对导入在构建期内联，运行时无自引用。
export * from "../index.ts";

// 通过模块合并向全局 Context.Config 追加本入口支持的配置项
declare module "@koishi-ce/core" {
	namespace Context {
		interface Config {
			/** 插件配置表，键为插件引用（可带 `group:` 前缀），值为插件配置 */
			plugins?: Dict;
			/** 时区偏移量（分钟） */
			timezoneOffset?: number;
			/** 报错时的调用堆栈深度上限 */
			stackTraceLimit?: number;
			/** 日志设置，见 logger.Config */
			logger?: logger.Config;
			/** 守护设置，见 daemon.Config */
			daemon?: daemon.Config;
		}
	}
}

// 向控制台"高级设置"分区注册本入口新增的配置项 schema
const advancedDict = Context.Config.Advanced.dict;
if (advancedDict) {
	Object.assign(advancedDict, {
		timezoneOffset: Schema.number()
			.description("时区偏移量 (分钟)。")
			.default(new Date().getTimezoneOffset()),
		stackTraceLimit: Schema.natural()
			.description("报错的调用堆栈深度。")
			.default(10),
		plugins: Schema.any().hidden(),
	});
}

/**
 * 未捕获异常的兜底处理：记录日志后以退出码 1 结束进程，
 * 交由父守护进程决定是否重启。
 */
function handleException(error: unknown) {
	new Logger("app").error(error);
	process.exit(1);
}

process.on("uncaughtException", handleException);

// Promise 拒绝不致命，仅告警，避免应用因单个异步错误退出
process.on("unhandledRejection", (error) => {
	new Logger("app").warn(error);
});

/** 应用启动主流程 */
async function start() {
	const loader = new Loader();
	await loader.init(process.env["KOISHI_CONFIG_FILE"]);
	const config = await loader.readConfig(true);
	logger.prepare(config.logger);

	if (config.timezoneOffset !== undefined) {
		Time.setTimezoneOffset(config.timezoneOffset);
	}

	if (config.stackTraceLimit !== undefined) {
		Error.stackTraceLimit = config.stackTraceLimit;
	}

	const app = await loader.createApp();
	// 挂载 daemon 插件以接管信号处理与心跳上报
	app.plugin(daemon, config.daemon);
	await app.start();
}

// 顶层 await 启动：main entry 的模块求值须挂起至启动链推进完成——
// 若以 start().catch(...) 形式让出，Bun 事件循环在无其他句柄时会随首个
// await 立即退出（进程静默 exit 0，插件与 daemon 心跳均来不及注册保活）
await start().catch(handleException);
