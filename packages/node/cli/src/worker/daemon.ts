// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * daemon 插件：worker 子进程侧的守护逻辑。
 *
 * 与父守护进程（src/cli/start.ts）配合：启动后上报自身配置，周期发送心跳，
 * 并在收到 SIGINT / SIGTERM 时广播 exit 事件、清理现场后退出进程。
 */

import { Context, Schema } from "@koishi-ce/core";

/** 守护设置 */
export interface Config {
	/** 运行时崩溃后是否自动重启 */
	autoRestart?: boolean;
	/** 心跳发送间隔（毫秒），0 表示不发送 */
	heartbeatInterval?: number;
	/** 心跳超时时间（毫秒），超时后父进程会强杀子进程，0 表示不检测 */
	heartbeatTimeout?: number;
}

export const Config: Schema<Config> = Schema.object({
	autoRestart: Schema.boolean()
		.description("在运行时崩溃自动重启。")
		.default(true),
	heartbeatInterval: Schema.number()
		.description("心跳发送间隔。")
		.default(0),
	heartbeatTimeout: Schema.number()
		.description("心跳超时时间。")
		.default(0),
})
	.description("守护设置")
	.hidden();

Context.Config.list.push(
	Schema.object({
		daemon: Config,
	}),
);

export const name = "daemon";

export function apply(ctx: Context, config: Config = {}) {
	/**
	 * 信号处理：先通知父进程"本次是主动退出"（防止被当作崩溃重启），
	 * 再广播 exit 事件等待各插件清理完毕后结束进程。
	 */
	function handleSignal(signal: NodeJS.Signals) {
		// 子进程主动退出时须防止父进程按 autoRestart 策略重启
		if (config.autoRestart) {
			process.send?.({ type: "exit" });
		}
		ctx.logger("app").info(`terminated by ${signal}`);
		ctx
			.parallel("exit", signal)
			.finally(() => process.exit());
	}

	ctx.on("ready", () => {
		// 向父进程上报守护配置，供其心跳超时与重启判定使用
		process.send?.({ type: "start", body: config });
		process.on("SIGINT", handleSignal);
		process.on("SIGTERM", handleSignal);

		// 按配置间隔向父进程发送心跳
		config.heartbeatInterval &&
			setInterval(() => {
				process.send?.({ type: "heartbeat" });
			}, config.heartbeatInterval);
	});
}
