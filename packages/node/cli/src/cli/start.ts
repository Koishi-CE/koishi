// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * `koishi start` 子命令实现：守护进程（daemon）侧的父进程逻辑。
 *
 * 通过 Bun.spawn 以 IPC 通道拉起 worker 子进程，并依据子进程发来的消息
 * （启动配置、共享环境数据、心跳）决定是否重启。子进程以约定的退出码
 * 表达意图：51 表示请求重启，52 表示请求退出，其余交由 autoRestart 判断。
 */

import { hyphenate, isInteger } from "@koishi-ce/utils";
import type { CAC } from "cac";
import pc from "picocolors";
import type { Config } from "../worker/daemon.ts";

/** 子进程通过 IPC 通道发来的消息类型（并集） */
type Event = Event.Start | Event.Env | Event.Heartbeat;
/** 单个命令行选项的取值形态 */
type WorkerOption = boolean | string | string[] | undefined;
/** 传递给 worker 的完整选项表；`--` 键对应 cac 收集的透传参数 */
type WorkerOptions = Record<string, WorkerOption> & {
	"--"?: string[];
};

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

/**
 * 收到停止信号后置位：此后 worker 的任何退出都只跟随退出，不再触发
 * 自动重启。容器场景下父进程是 PID 1，docker stop 的 SIGTERM 只到这里，
 * 必须显式转发给 worker，否则 worker 会被容器回收时直接 SIGKILL。
 */
let stopping = false;

/** 信号处理器只安装一次：createWorker 会在重启时递归调用，不能重复注册 */
let signalsInstalled = false;

/** 转发停止信号后等待 worker 优雅退出的兜底时长，超时强杀 */
const STOP_TIMEOUT = 10_000;

/**
 * 把停止信号转发给 worker，并等待其走完 daemon 的 exit 清理。
 *
 * 本地终端 Ctrl+C 会把 SIGINT 同时发给父进程与 worker，worker 侧
 * daemon 对重复信号做了幂等处理；容器内则只有 PID 1（本进程）收到。
 */
function handleSignal(signal: NodeJS.Signals) {
	if (stopping) return;
	stopping = true;
	// child 可能恰好已退出（kill 会以 ESRCH 抛错），停止流程不能被它打断
	try {
		child?.kill(signal);
	} catch {}
	const timer = setTimeout(() => {
		try {
			child?.kill("SIGKILL");
		} catch {}
		process.exit(1);
	}, STOP_TIMEOUT);
	// 定时器不应阻止事件循环退出（worker 正常退出后父进程立即结束）
	timer.unref?.();
}

/** 首次拉起 worker 时安装信号处理器（模块导入本身不产生副作用） */
function installSignalHandlers() {
	if (signalsInstalled) return;
	signalsInstalled = true;
	process.on("SIGINT", handleSignal);
	process.on("SIGTERM", handleSignal);
}

// 跨重启保留的共享数据：首次启动仅记录启动时间，后续由子进程回传覆盖
process.env["KOISHI_SHARED"] = JSON.stringify({
	startTime: Date.now(),
});

/**
 * 退出决策（纯函数，导出供单测）：返回退出码表示父进程退出，返回 null
 * 表示按 daemon 的 autoRestart 策略重新拉起 worker。
 *
 * 竞态边界：stopping 优先于一切退出码判断——收到 SIGTERM/SIGINT 后，
 * 即使 worker 恰好以「请求重启」的退出码 51 结束（或崩溃），也不能再次
 * 拉起，否则 docker stop 会因进程不断重启而卡到超时 SIGKILL。
 */
export function resolveExit(
	code: number | null,
	signal: NodeJS.Signals | number | null,
	config: Config | undefined,
	stopping: boolean,
): number | null {
	// 停止信号已发出：无条件跟随退出，退出码缺省按 0 处理
	if (stopping) return code ?? 0;

	// 尚未收到 start 消息即退出，说明启动失败
	if (!config) return code ?? 1;

	// 手动退出（正常退出码或被信号终止）
	if (code === 0) return 0;
	if (signal !== null) return code ?? 1;

	// 手动重启 / 手动停止
	if (code === 51) return null;
	if (code === 52) return code;

	// 其余情况交由 autoRestart 配置决定
	return config.autoRestart ? null : (code ?? 1);
}

/**
 * 将 cac 解析出的选项键转换为命令行参数形式。
 * 单字母键转为 `-x`，其余转为 `--kebab-case`。
 */
function toArg(key: string) {
	return key.length === 1
		? `-${key}`
		: `--${hyphenate(key)}`;
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
	// 容器内父进程即 PID 1：信号转发必须先于 spawn 安装（见 handleSignal）
	installSignalHandlers();

	// 将选项对象还原为 Node/Bun 可识别的 execArgv 数组
	const execArgv = Object.entries(options).flatMap<string>(
		([key, value]) => {
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
		},
	);
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
						console.log(
							pc.red("daemon: heartbeat timeout"),
						);
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
				console.log(pc.red("daemon: heartbeat timeout"));
				child.kill("SIGKILL");
			}, config.heartbeatTimeout);
		}
	};

	child = Bun.spawn(
		[process.execPath, worker, ...execArgv],
		{
			ipc: handleMessage,
			// Bun.spawn 的默认 env 继承在 win32 只取进程启动时的 OS 环境
			// 快照，运行时经 process.env 赋值的 KOISHI_* 选项（log-level /
			// debug / config-file / shared）到不了子进程，须显式展开传递
			env: { ...process.env },
			// Bun.spawn 的 stdio 默认为 ignore，须显式继承输出通道，
			// 否则 worker 的全部日志都会被丢弃
			stdout: "inherit",
			stderr: "inherit",
			onExit: (_, code, signal) => {
				const exitCode = resolveExit(
					code,
					signal,
					config,
					stopping,
				);
				if (exitCode !== null) process.exit(exitCode);
				createWorker(options);
			},
		},
	);
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
		.option(
			"--debug [namespace]",
			"specify debug namespace",
		)
		.option(
			"--log-level [level]",
			"specify log level (default: 2)",
		)
		.option("--log-time [format]", "show timestamp in logs")
		.action((file, options) => {
			const { logLevel, debug, logTime, ...rest } = options;
			if (
				logLevel !== undefined &&
				(!isInteger(logLevel) || logLevel < 0)
			) {
				// eslint-disable-next-line no-console
				console.warn(
					`${pc.red("error")} log level should be a positive integer.`,
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
