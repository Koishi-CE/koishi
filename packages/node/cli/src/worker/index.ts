import { Context, type Dict, Logger, Schema, Time } from "@koishi-ce/core";
import Loader from "@koishi-ce/loader";
import * as daemon from "./daemon";
import * as logger from "./logger";

export * from "@koishi-ce/koishi";

declare module "@koishi-ce/core" {
	namespace Context {
		interface Config {
			plugins?: Dict;
			timezoneOffset?: number;
			stackTraceLimit?: number;
			logger?: logger.Config;
			daemon?: daemon.Config;
		}
	}
}

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

function handleException(error: unknown) {
	new Logger("app").error(error);
	process.exit(1);
}

process.on("uncaughtException", handleException);

process.on("unhandledRejection", (error) => {
	new Logger("app").warn(error);
});

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
	app.plugin(daemon, config.daemon);
	await app.start();
}

start().catch(handleException);
