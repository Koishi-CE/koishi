/**
 * 日志配置的解析与应用（worker 侧）。
 *
 * 在应用启动前根据配置文件与 CLI 环境变量（KOISHI_LOG_LEVEL / KOISHI_DEBUG 等）
 * 完成全局 Logger 的等级、时间格式等设定。CLI 传入的环境变量优先级高于配置文件。
 */

import { Context, defineProperty, Logger, Schema } from "@koishi-ce/core";

/**
 * 配置文件形态的日志等级表。
 * 与 @koishi-ce/utils 中的实现略有差异：此处不强制用户提供 base 等级，
 * 缺省时回退到继承的默认值。
 */
interface LogLevelConfig {
	/** 基础日志等级，未提供时沿用上级默认值 */
	base?: number;
	[k: string]: LogLevel;
}

/** 日志等级：既可以是单一数值，也可以是按名称分级的嵌套配置表 */
type LogLevel = number | LogLevelConfig;

/**
 * 将配置文件形态的等级表归一化为 Logger 内部的 LevelConfig 结构：
 * 逐层填充 base 并递归处理嵌套对象。
 */
function normalizeLevels(
	config: LogLevelConfig,
	base: number,
): Logger.LevelConfig {
	const result: Logger.LevelConfig = { base: config.base ?? base };
	for (const [name, level] of Object.entries(config)) {
		if (name === "base") continue;
		result[name] =
			typeof level === "number" ? level : normalizeLevels(level, result.base);
	}
	return result;
}

/** 日志设置 */
export interface Config {
	/** 默认的日志输出等级 */
	levels?: LogLevel;
	/** 是否标注相邻两次日志输出的时间差 */
	showDiff?: boolean;
	/** 日志时间戳的输出格式，true 表示使用默认格式 */
	showTime?: string | boolean;
}

export const Config: Schema<Config> = Schema.object({
	levels: Schema.any().description("默认的日志输出等级。"),
	showDiff: Schema.boolean().description("标注相邻两次日志输出的时间差。"),
	showTime: Schema.union([Boolean, String])
		.default(true)
		.description("输出日志所使用的时间格式。"),
})
	.description("日志设置")
	.hidden();

defineProperty(Context.Config, "logger", Config);

Context.Config.list.push(
	Schema.object({
		logger: Config,
	}),
);

/**
 * 在应用启动前应用日志配置。
 *
 * 处理顺序：配置文件中的等级表 → 时间格式与时间差显示 → CLI 环境变量覆盖 →
 * 补全所有分组的 base 等级 → KOISHI_DEBUG 指定的命名空间设为 DEBUG 级。
 *
 * @param config 来自配置文件 logger 节点的设置
 */
export function prepare(config: Config = {}) {
	const { levels } = config;
	// 应用配置文件中的日志等级设置
	if (typeof levels === "object") {
		Logger.levels = normalizeLevels(levels, 2);
	} else if (typeof levels === "number") {
		Logger.levels.base = levels;
	}

	let showTime = config.showTime;
	if (showTime === true) showTime = "yyyy-MM-dd hh:mm:ss";
	const target = Logger.targets[0];
	if (target) {
		if (showTime) target.showTime = showTime;
		target.showDiff = config.showDiff ?? false;
	}

	// CLI 传入的选项优先级高于配置文件
	if (process.env["KOISHI_LOG_LEVEL"]) {
		Logger.levels.base = +process.env["KOISHI_LOG_LEVEL"];
	}

	/** 递归为所有子命名空间补全 base 等级（未显式设置时继承父级） */
	function ensureBaseLevel(config: Logger.LevelConfig, base: number) {
		config.base ??= base;
		Object.values(config).forEach((value) => {
			if (typeof value !== "object") return;
			ensureBaseLevel(value, config.base);
		});
	}

	ensureBaseLevel(Logger.levels, 2);

	// KOISHI_DEBUG 指定的各个命名空间一律开启 DEBUG 级输出
	if (process.env["KOISHI_DEBUG"]) {
		for (const name of process.env["KOISHI_DEBUG"].split(",")) {
			new Logger(name).level = Logger.DEBUG;
		}
	}

	// 重置时间差计算的基准时间戳，避免把启动前的耗时计入首条日志
	if (target) target.timestamp = Date.now();
}
