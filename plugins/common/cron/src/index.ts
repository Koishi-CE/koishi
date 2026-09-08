// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 计划任务插件（cron）：向 Context 注入 ctx.cron(input, callback) 服务，
 * 按 cron 表达式周期执行回调，返回取消函数。
 *
 * 上游 koishijs/koishi-plugin-cron 与社区 cron-fix 均以 cron-parser 计算
 * 下次触发时刻后交给 setTimeout——间隔超过 2^31-1 ms（约 24.8 天）时被
 * 运行时钳为 1ms 立即触发，月度及以上周期的任务会风暴执行直至崩死
 * （见 koishijs/koishi-plugin-cron#8）。本实现改用 Bun.cron 原生调度，
 * 天然不受 32 位溢出影响，且不引入任何第三方 cron 解析依赖。
 *
 * 表达式语法面（Bun.cron 原生）：标准 5 字段（分 时 日 月 周）与
 * @hourly / @daily / @weekly / @monthly / @yearly 宏；不支持秒字段与
 * L / W / # 修饰符。无效表达式在注册时同步抛出 TypeError。
 */
import { Context, Schema } from "@koishi-ce/koishi";

export const name = "cron";
export const reusable = false;
export const filter = false;

export interface Config {
	/** 解析表达式所用 IANA 时区（如 Asia/Shanghai），缺省为系统本地时区 */
	tz?: string;
}

export const Config: Schema<Config> = Schema.object({
	tz: Schema.string().description(
		"解析表达式所用的 IANA 时区名（如 Asia/Shanghai），留空使用系统本地时区。",
	),
});

/** 任务回调；支持异步，抛出的错误会被捕获并记入日志，不影响后续调度 */
export type CronCallback = () => void | Promise<void>;

/** ctx.cron 服务签名：注册一个计划任务，返回取消函数 */
export type Cron = (
	this: Context,
	input: string,
	callback: CronCallback,
) => () => void;

declare module "@koishi-ce/koishi" {
	interface Context {
		/** 注册一个 cron 计划任务，返回取消函数 */
		cron: Cron;
	}
}

export function apply(ctx: Context, config: Config) {
	const logger = ctx.logger(name);

	const cron: Cron = function (
		this: Context,
		input,
		callback,
	) {
		// this 为调用方 Context（由下方归属标记保证）；解构调用等丢失 this
		// 的场景回退到插件自身 ctx，任务生命周期仍随插件卸载回收
		const caller = this ?? ctx;
		const job = Bun.cron(
			input,
			async () => {
				try {
					await callback();
				} catch (error) {
					logger.error(`计划任务执行失败：${input}`, error);
				}
			},
			config.tz ? { tz: config.tz } : undefined,
		);
		return caller.effect(() => () => {
			job.stop();
		});
	};

	// 函数服务的归属标记：cordis 依赖注入据此把调用时的 this 绑定到调用方 Context
	Object.defineProperty(cron, Context.current, {
		value: ctx,
		configurable: true,
	});
	ctx.set("cron", cron);
}
