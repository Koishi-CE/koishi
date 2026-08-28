import { Context, defineProperty, Logger, Schema } from "@koishi-ce/core";

interface LogLevelConfig {
	// a little different from @koishi-ce/utils
	// we don't enforce user to provide a base here
	base?: number;
	[k: string]: LogLevel;
}

type LogLevel = number | LogLevelConfig;

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

export interface Config {
	levels?: LogLevel;
	showDiff?: boolean;
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

export function prepare(config: Config = {}) {
	const { levels } = config;
	// configurate logger levels
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

	// cli options have higher precedence
	if (process.env["KOISHI_LOG_LEVEL"]) {
		Logger.levels.base = +process.env["KOISHI_LOG_LEVEL"];
	}

	function ensureBaseLevel(config: Logger.LevelConfig, base: number) {
		config.base ??= base;
		Object.values(config).forEach((value) => {
			if (typeof value !== "object") return;
			ensureBaseLevel(value, config.base);
		});
	}

	ensureBaseLevel(Logger.levels, 2);

	if (process.env["KOISHI_DEBUG"]) {
		for (const name of process.env["KOISHI_DEBUG"].split(",")) {
			new Logger(name).level = Logger.DEBUG;
		}
	}

	if (target) target.timestamp = Date.now();
}
