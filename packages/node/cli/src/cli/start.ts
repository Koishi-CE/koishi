/**
 * `koishi start` 子命令实现：守护进程（daemon）侧的父进程逻辑。
 *
 * 通过 Bun.spawn 以 IPC 通道拉起 worker 子进程，并依据子进程发来的消息
 * （启动配置、共享环境数据、心跳）决定是否重启。子进程以约定的退出码
 * 表达意图：51 表示请求重启，52 表示请求退出，其余交由 autoRestart 判断。
 */

import { hyphenate, isInteger } from "@koishi-ce/utils";
import type { CAC } from "cac";
import kleur from "kleur";
import type { Config } from "../worker/daemon";

/** 子进程通过 IPC 通道发来的消息类型（并集） */
type Event = Event.Start | Event.Env | Event.Heartbeat;
/** 单个命令行选项的取值形态 */
type WorkerOption = boolean | string | string[] | undefined;
/** 传递给 worker 的完整选项表；`--` 键对应 cac 收集的透传参数 */
type WorkerOptions = Record<string, WorkerOption> & { "--"?: string[] };

/** 子进程 IPC 消息的具体结构定义 */
namespace Event {
	/** worker 启动完成，附带解析后的守护配置 */
	export interface Start {
		type: "start";
		body: Config;
	}

	/** loader 触发整进程重载时回传的共享环境数据（KOISHI_SHARED） */
	export interface Env {
		type: "shared";
		body: string;
	}

	/** 周期性心跳，用于父进程检测子进程是否假死 */
	export interface Heartbeat {
		type: "heartbeat";
	}
}

let child: Bun.Subprocess;

// 跨重启保留的共享数据：首次启动仅记录启动时间，后续由子进程回传覆盖
process.env["KOISHI_SHARED"] = JSON.stringify({
	startTime: Date.now(),
});

/**
 * 将 cac 解析出的选项键转换为命令行参数形式。
 * 单字母键转为 `-x`，其余转为 `--kebab-case`。
 */
function toArg(key: string) {
	return key.length === 1 ? `-${key}` : `--${hyphenate(key)}`;
}

/**
 * 拉起 worker 子进程并接管其生命周期。
 *
 * @param options 命令行选项，会被还原成 execArgv 传给子进程
 *
 * 子进程退出时依据退出码/信号判断是重启还是跟随退出；
 * 启动后若配置了心跳超时，则心跳超时视为进程假死，直接 SIGKILL。
 */
function createWorker(options: WorkerOptions) {
	// 将选项对象还原为 Node/Bun 可识别的 execArgv 数组
	const execArgv = Object.entries(options).flatMap<string>(([key, value]) => {
		if (key === "--") return [];
		key = toArg(key);
		if (value === true) {
			return [key];
		} else if (value === false) {
			// 布尔假值转为 --no-xxx 形式
			return [`--no-${key.slice(2)}`];
		} else if (Array.isArray(value)) {
			// 数组值展开为多组 "键 值" 对
			return value.flatMap((value) => [key, value]);
		} else {
			return [key, String(value)];
		}
	});
	execArgv.push(...(options["--"] ?? []));

	// worker 入口为构建产物 index.mjs，而非本 TS 源文件
	const worker = `${import.meta.dir}/../worker/index.mjs`;

	let config: Config;
	let timer: ReturnType<typeof setTimeout> | undefined;
	// 处理子进程 IPC 消息：start / shared / heartbeat
	const handleMessage = (message: Event) => {
		if (message.type === "start") {
			config = message.body;
			timer = config.heartbeatTimeout
				? setTimeout(() => {
						// eslint-disable-next-line no-console
						console.log(kleur.red("daemon: heartbeat timeout"));
						child.kill("SIGKILL");
					}, config.heartbeatTimeout)
				: undefined;
		} else if (message.type === "shared") {
			process.env["KOISHI_SHARED"] = message.body;
		} else if (
			message.type === "heartbeat" &&
			timer &&
			config.heartbeatTimeout
		) {
			clearTimeout(timer);
			timer = setTimeout(() => {
				// eslint-disable-next-line no-console
				console.log(kleur.red("daemon: heartbeat timeout"));
				child.kill("SIGKILL");
			}, config.heartbeatTimeout);
		}
	};

	child = Bun.spawn([process.execPath, worker, ...execArgv], {
		ipc: handleMessage,
		// Bun.spawn 的 stdio 默认为 ignore，须显式继承输出通道，
		// 否则 worker 的全部日志都会被丢弃
		stdout: "inherit",
		stderr: "inherit",
		onExit: (_, code, signal) => {
			if (shouldExit(code, signal)) {
				process.exit(code ?? 1);
			}
			createWorker(options);
		},
	});

	/**
	 * 判断子进程退出后父进程应跟随退出还是重新拉起。
	 *
	 * 退出码约定：0 表示正常退出；51 表示请求重启（如 loader 的整进程重载）；
	 * 52 表示请求退出；收到信号一律视为外部终止，跟随退出。
	 */
	function shouldExit(code: number | null, signal: number | null) {
		// 尚未收到 start 消息即退出，说明启动失败
		if (!config) return true;

		// 手动退出（正常退出码或被信号终止）
		if (code === 0) return true;
		if (signal !== null) return true;

		// 手动重启 / 手动停止
		if (code === 51) return false;
		if (code === 52) return true;

		// 其余情况交由 autoRestart 配置决定
		return !config.autoRestart;
	}
}

/**
 * 将命令行选项写入环境变量。
 * 值为 `true` 时写入空字符串（仅表示开关打开），其余写入字符串值。
 */
function setEnvArg(name: string, value: string | boolean) {
	if (value === true) {
		process.env[name] = "";
	} else if (value) {
		process.env[name] = value;
	}
}

/**
 * 向 cac 实例注册 `koishi start`（别名 `koishi run`）子命令。
 *
 * 解析 --debug / --log-level / --log-time 等选项后，把它们写入对应的环境变量
 * （由 worker 侧的 logger 读取），最后交给 createWorker 拉起守护子进程。
 */
export default function (cli: CAC) {
	cli
		.command("start [file]", "start a koishi bot")
		.alias("run")
		.allowUnknownOptions()
		.option("--debug [namespace]", "specify debug namespace")
		.option("--log-level [level]", "specify log level (default: 2)")
		.option("--log-time [format]", "show timestamp in logs")
		.action((file, options) => {
			const { logLevel, debug, logTime, ...rest } = options;
			if (logLevel !== undefined && (!isInteger(logLevel) || logLevel < 0)) {
				// eslint-disable-next-line no-console
				console.warn(
					`${kleur.red("error")} log level should be a positive integer.`,
				);
				process.exit(1);
			}
			setEnvArg("KOISHI_LOG_TIME", logTime);
			process.env["KOISHI_LOG_LEVEL"] = logLevel || "";
			process.env["KOISHI_DEBUG"] = debug || "";
			process.env["KOISHI_CONFIG_FILE"] = file || "";
			createWorker(rest);
		});
}
