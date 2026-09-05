// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * worker 子进程入口：真正启动 Koishi 应用的地方。
 *
 * 由 CLI 守护进程（src/cli/start.ts）通过 Bun.spawn 拉起。流程为：
 * 初始化 Loader 并读取配置文件 → 应用日志配置 → 应用时区与堆栈深度设置 →
 * 创建应用上下文 → 挂载 daemon 插件 → 启动。未捕获异常将以错误码 1 退出，
 * 由父进程依据退出码决定是否重启。
 */

import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { dirname, resolve } from "node:path";
import {
	Context,
	type Dict,
	Logger,
	Schema,
	Time,
} from "@koishi-ce/core";
import Loader, { resolvePlugin } from "@koishi-ce/loader";
import pc from "picocolors";
import * as daemon from "./daemon.ts";
import * as logger from "./logger.ts";

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

/** HTTP 服务器插件的包名集合（端口预检的识别目标，覆盖本仓 vendored 包与上下游命名） */
const serverPackages = new Set([
	"@koishi-ce/plugin-server",
	"@koishijs/plugin-server",
	"@cordisjs/plugin-server",
]);

/** 服务器插件声明的待检端口区间 */
interface ServerPort {
	host: string;
	port: number;
	maxPort: number;
}

/** 从模块入口路径向上查找最近的 package.json，返回其 name 字段 */
function locatePackageName(
	filename: string,
): string | undefined {
	let dir = dirname(filename);
	while (true) {
		const file = resolve(dir, "package.json");
		if (existsSync(file)) {
			try {
				const manifest = JSON.parse(
					readFileSync(file, "utf8"),
				);
				if (typeof manifest?.name === "string")
					return manifest.name;
			} catch {}
		}
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

/**
 * 遍历插件配置表（含 group 嵌套），收集服务器插件声明的端口区间。
 * 引用键格式与 loader 一致：首个冒号前为插件名；`$` 开头为元属性。
 */
function collectServerPorts(
	plugins: Dict,
	baseDir: string,
	out: ServerPort[],
) {
	for (const [key, source] of Object.entries(plugins)) {
		if (
			key.startsWith("$") ||
			source === null ||
			typeof source !== "object"
		) {
			continue;
		}
		const [name = ""] = key.split(":", 1);
		if (name === "group") {
			collectServerPorts(source as Dict, baseDir, out);
			continue;
		}
		try {
			const pkgName = locatePackageName(
				resolvePlugin(name, baseDir),
			);
			if (!pkgName || !serverPackages.has(pkgName))
				continue;
			const { host, port, maxPort } = source as Record<
				string,
				unknown
			>;
			if (typeof port !== "number") continue;
			out.push({
				host: typeof host === "string" ? host : "127.0.0.1",
				port,
				maxPort:
					typeof maxPort === "number" ? maxPort : port,
			});
		} catch {}
	}
}

/** 探测端口当前是否可绑定（未被占用返回 true） */
function probePort(port: number, host: string) {
	return new Promise<boolean>((promiseResolve) => {
		const server = net.createServer();
		server.once("error", () => promiseResolve(false));
		server.once("listening", () =>
			server.close(() => promiseResolve(true)),
		);
		server.listen(port, host);
	});
}

/**
 * 端口预检：server 插件在应用启动期绑定失败会以 cordis 错误事件暴露，
 * 连锁触发依赖 server 服务的全部插件 dispose，堆栈噪音远超问题本身；
 * 这里在创建应用前先行探测，端口区间全部被占时只输出一行提示并以
 * 退出码 1 结束（父守护进程未收到 start 消息，随之干净退出）。
 */
async function checkPorts(plugins: Dict, baseDir: string) {
	const ports: ServerPort[] = [];
	collectServerPorts(plugins, baseDir, ports);
	for (const { host, port, maxPort } of ports) {
		let available = false;
		for (
			let current = port;
			current <= maxPort;
			current++
		) {
			if (await probePort(current, host)) {
				available = true;
				break;
			}
		}
		if (available) continue;
		const range =
			port === maxPort ? `${port}` : `${port}-${maxPort}`;
		new Logger("app").error(
			`端口 ${range} 已被占用（可能已有 Koishi 实例在运行），启动中止`,
		);
		process.exit(1);
	}
}

/** 启动字符画（ANSI Shadow 字体的 KOISHI CE） */
const banner = [
	"██╗  ██╗ ██████╗ ██╗███████╗██╗  ██╗██╗       ██████╗███████╗",
	"██║ ██╔╝██╔═══██╗██║██╔════╝██║  ██║██║      ██╔════╝██╔════╝",
	"█████╔╝ ██║   ██║██║███████╗███████║██║█████╗██║     █████╗",
	"██╔═██╗ ██║   ██║██║╚════██║██╔══██║██║╚════╝██║     ██╔══╝",
	"██║  ██╗╚██████╔╝██║███████║██║  ██║██║      ╚██████╗███████╗",
	"╚═╝  ╚═╝ ╚═════╝ ╚═╝╚══════╝╚═╝  ╚═╝╚═╝       ╚═════╝╚══════╝",
].join("\n");

/**
 * 输出启动字符画。直走 stdout 而非 Logger 通道（多行消息会被日志器
 * 统一缩进、首行混入时间戳前缀，破坏字符画对齐），因此以 isTTY 收敛：
 * 测试与重定向/CI 等非交互环境自动跳过，不产生输出噪音。
 */
function printBanner() {
	if (!process.stdout.isTTY) return;
	console.log(pc.white(banner));
}

/** 应用启动主流程 */
async function start() {
	const loader = new Loader();
	await loader.init(process.env["KOISHI_CONFIG_FILE"]);
	const config = await loader.readConfig(true);
	logger.prepare(config.logger);
	printBanner();

	// 端口预检须在日志配置生效后、应用创建前执行
	await checkPorts(config.plugins ?? {}, loader.baseDir);

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
