// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 指令调用频率限制插件（rate-limit）。
 *
 * 为每条指令提供两类限制，计数与计时存于 user 表的 usage / timers
 * 两个 json 字段（跨日自动清零 / 到期自动清理）：
 * - maxUsage：每日调用次数上限（按 usageName 或指令名计数）；
 * - minInterval：连续两次调用的最小间隔。
 * 选项可标记 notUsage（不计入调用次数），指令可配置 bypassAuthority
 * （已废弃，建议改用 filter）放行高权限用户；附带 usage / timer 两个
 * 管理指令查看与修改数据，并扩展 help 的指令与选项输出。
 */
import {
	type Command,
	type Computed,
	type Context,
	type Dict,
	Schema,
	type Session,
	Time,
	type User,
} from "@koishi-ce/koishi";
// 仅类型依赖：纳入 help 插件的 help/command、help/option 事件声明
import type {} from "@koishi-ce/plugin-help";
import zhCN from "../locales/zh-CN.yml";
import * as admin from "./admin.ts";

declare module "@koishi-ce/koishi" {
	namespace Command {
		interface Config {
			/** 调用次数的标识符 */
			usageName?: string;
			/** 每天的调用次数上限 */
			maxUsage?: Computed<number>;
			/** 连续调用的最小间隔 */
			minInterval?: Computed<number>;
			/** @deprecated 已废弃，请改用 filter */
			bypassAuthority?: Computed<number>;
		}
	}

	interface User {
		/** 各功能的当日调用计数（_date 记录计数日期，跨日自动清零） */
		usage: Dict<number>;
		/** 各功能的下次可调用时间戳（_date 记录到期日期，到期自动清理） */
		timers: Dict<number>;
	}
}

/**
 * 选项声明上由本插件运行时注入的字段（notUsage 经 schema.extend 注册进
 * command-option 聚合 Schema）。类型层刻意不向全局 Argv.OptionConfig 做
 * 同名增强：增强会让 help 插件为 notUsage 预留的 @ts-expect-error 失效
 * （TS2578），破坏大一统类型检查；若要恢复全局增强，须先删除 help 侧
 * 的 @ts-expect-error 注释。
 */
interface UsageOption {
	/** 不计入调用次数 */
	notUsage?: boolean;
}

/** 配置项（当前无可用配置） */
export type Config = Record<never, never>;

export const name = "rate-limit";
export const inject = ["database"];
export const Config: Schema<Config> = Schema.object({});

export function apply(ctx: Context) {
	ctx.i18n.define("zh-CN", zhCN);

	// user 表扩展：计数与计时各占一个 json 字段
	ctx.model.extend("user", {
		usage: "json",
		timers: "json",
	});

	ctx.schema.extend(
		"command",
		Schema.object({
			usageName: Schema.string().description(
				"调用次数的标识符。",
			),
			maxUsage: Schema.computed(Schema.number(), {
				userFields: ["authority"],
			})
				.default(0)
				.description("每天的调用次数上限。"),
			minInterval: Schema.computed(Schema.number(), {
				userFields: ["authority"],
			})
				.default(0)
				.description("连续调用的最小间隔。"),
		}),
		800,
	);

	ctx.schema.extend(
		"command-option",
		Schema.object({
			notUsage: Schema.boolean()
				.default(false)
				.description("不计入调用次数。"),
		}),
		800,
	);

	// 声明数据预取：按指令配置决定执行前观测哪些用户字段
	ctx.before("command/attach-user", (argv, fields) => {
		const { command, options = {} } = argv;
		if (!command) return;
		const { maxUsage, minInterval, bypassAuthority } =
			command.config;
		let shouldFetchUsage = !!(maxUsage || minInterval);
		for (const [name, { notUsage }] of Object.entries(
			command._options,
		) as [string, UsageOption][]) {
			// --help 不计入调用次数（上游 koishijs/koishi#772）
			if (name === "help") continue;
			if (name in options && notUsage)
				shouldFetchUsage = false;
		}
		if (shouldFetchUsage) {
			fields.add("authority");
			if (maxUsage) fields.add("usage");
			if (minInterval) fields.add("timers");
		}
		if (bypassAuthority) fields.add("authority");
	});

	/**
	 * 判断会话用户是否豁免频率限制：未登录（无用户数据）或权限等级
	 * 不低于指令的 bypassAuthority 配置时放行。
	 */
	function bypassRateLimit<F extends User.Field>(
		session: Session<F | "authority">,
		command: Command,
	) {
		if (!session.user) return true;
		// 未配置时取 Infinity：任何权限都达不到，即不豁免（与上游语义一致）
		const bypassAuthority = session.resolve(
			command.config.bypassAuthority ?? Infinity,
		);
		if (session.user.authority >= bypassAuthority)
			return true;
		return false;
	}

	// 执行前检查：间隔过短 / 次数用尽时按 showWarning 配置输出提示并短路
	ctx.before("command/execute", (argv) => {
		const { session, options = {}, command } = argv;
		if (!command || !session) return;
		// authority / usage / timers 字段由上方 command/attach-user 钩子收集，
		// 事件载荷的 Argv 是擦除泛型，此处还原观察类型
		const scoped = session as Session<
			"authority" | "usage" | "timers"
		>;
		if (!scoped.user) return;
		if (bypassRateLimit(scoped, command)) return;

		function sendHint(path: string, ...param: unknown[]) {
			if (!command?.config.showWarning) return "";
			return (
				session?.text(
					[`.${path}`, `internal.${path}`],
					param,
				) ?? ""
			);
		}

		let isUsage = true;
		for (const [name, { notUsage }] of Object.entries(
			command._options,
		) as [string, UsageOption][]) {
			if (name in options && notUsage) isUsage = false;
		}

		// 命中了不计次数的选项时放行
		if (!isUsage) return;

		const name = getUsageName(command);
		const minInterval =
			session.resolve(command.config.minInterval) ?? 0;
		const maxUsage =
			session.resolve(command.config.maxUsage) ?? 0;

		// 间隔检查应先于次数检查（上游 koishijs/koishi#752）
		if (
			minInterval > 0 &&
			checkTimer(name, scoped.user, minInterval)
		) {
			return sendHint("too-frequent");
		}

		if (
			maxUsage > 0 &&
			checkUsage(name, scoped.user, maxUsage)
		) {
			return sendHint("usage-exhausted");
		}
		return;
	});

	// 扩展 help 的指令输出：已调用次数与下次可调用时间
	ctx.on("help/command", (output, command, session) => {
		if (
			bypassRateLimit(
				session as Session<"authority">,
				command,
			)
		)
			return;

		// help 指令输出前已按目标指令的声明 observeUser（见 help 插件 showHelp）
		const user = session.user as User.Observed<
			"usage" | "timers"
		>;
		const name = getUsageName(command);
		const maxUsage =
			session.resolve(command.config.maxUsage) ?? Infinity;
		const minInterval =
			session.resolve(command.config.minInterval) ?? 0;

		if (maxUsage < Infinity) {
			const count = getUsage(name, user);
			output.push(
				session.text("internal.command-max-usage", [
					Math.min(count, maxUsage),
					maxUsage,
				]),
			);
		}

		if (minInterval > 0) {
			const due = user.timers[name];
			const nextUsage = due
				? (Math.max(0, due - Date.now()) / 1000).toFixed()
				: 0;
			output.push(
				session.text("internal.command-min-interval", [
					nextUsage,
					minInterval / 1000,
				]),
			);
		}
	});

	// 扩展 help 的选项输出：为 notUsage 选项附加标注
	ctx.on(
		"help/option",
		(output, option, command, session) => {
			if (
				bypassRateLimit(
					session as Session<"authority">,
					command,
				)
			)
				return output;
			const maxUsage = session.resolve(
				command.config.maxUsage,
			);
			if (
				(option as UsageOption).notUsage &&
				maxUsage !== Infinity
			) {
				output += session.text("internal.option-not-usage");
			}
			return output;
		},
	);

	ctx.plugin(admin);
}

export function getUsageName(command: Command) {
	return (
		command.config.usageName ||
		command.name.replace(/\./g, ":")
	);
}

export function getUsage(
	name: string,
	user: Pick<User, "usage">,
) {
	const _date = Time.getDateNumber();
	if (user.usage["_date"] !== _date) {
		user.usage = { _date };
	}
	return user.usage[name] || 0;
}

export function checkUsage(
	name: string,
	user: Pick<User, "usage">,
	maxUsage?: number,
) {
	// 旧数据可能缺少 usage 字段；maxUsage 未设置时不做限制（与上游一致）
	if (!user.usage || maxUsage === undefined) return;
	const count = getUsage(name, user);
	if (count >= maxUsage) return true;
	if (maxUsage) {
		user.usage[name] = count + 1;
	}
	return false;
}

export function checkTimer(
	name: string,
	{ timers }: Pick<User, "timers">,
	offset?: number,
) {
	const now = Date.now();
	// _date 记录到期时间：过期则清理全部已到期的定时器并续期（缺省视为已过期）
	if (!(now <= (timers["_date"] ?? 0))) {
		for (const key in timers) {
			if (now > (timers[key] ?? Infinity))
				delete timers[key];
		}
		timers["_date"] = now + Time.day;
	}
	if (now <= (timers[name] ?? 0)) return true;
	if (offset !== undefined) {
		timers[name] = now + offset;
	}
	return false;
}
