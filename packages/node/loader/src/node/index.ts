/**
 * NodeLoader：Loader 的 Node 环境实现。
 *
 * 相比基类，它补充了三块能力：
 * - 借助 ns-require 解析 `koishi-plugin-*` 插件的实际路径并以 require() 加载；
 * - 读取 .env / .env.local 并注入 process.env（记录注入键避免污染宿主环境，
 *   实现见 env.ts）；
 * - 历史配置迁移：把旧版内置功能（request、代理、服务器端口等）
 *   改写为对应插件的形式，并同步维护 package.json 依赖表（实现见 migration.ts）。
 *
 * 与运行环境无关的抽象基类见 base.ts，公共出口见 shared.ts。
 */

import { type Dict, Logger } from "@koishi-ce/core";
import ns from "ns-require";
import Loader from "./base";
import { injectEnv, parseEnvFiles, revertEnv } from "./env";
import { migrateManifest } from "./migration";

export { Loader } from "./base";
export type { LoaderScope, StartMessage } from "./types";
export { unwrapExports } from "./utils";

const logger = new Logger("app");

// eslint-disable-next-line n/no-deprecated-api
for (const key in require.extensions) {
	Loader.extensions.add(key);
}

export default class NodeLoader extends Loader {
	/** ns-require 的命名空间解析器，负责插件名到模块路径的解析 */
	public scope!: ns.Scope;
	/** 由 env 文件注入 process.env 的键（重读配置前先撤销） */
	public localKeys: string[] = [];

	override async init(filename?: string) {
		await super.init(filename);
		this.scope = ns({
			namespace: "koishi",
			prefix: "plugin",
			official: "koishi-ce",
			dirname: this.baseDir,
		});
	}

	/**
	 * 迁移旧版数据库插件配置：
	 * - mysql/mongo/postgres：补默认数据库名 koishi；
	 * - sqlite：补默认数据库路径 data/koishi.db。
	 * 其余交给基类处理。
	 */
	override migrateEntry(name: string, config: Dict) {
		config ??= {};
		if (
			["database-mysql", "database-mongo", "database-postgres"].includes(name)
		) {
			config["database"] ??= "koishi";
		} else if (name === "database-sqlite") {
			config["path"] ??= "data/koishi.db";
		} else {
			return super.migrateEntry(name, config);
		}
		return config;
	}

	override async migrate() {
		await migrateManifest(this.config as Dict);
		await super.migrate();
	}

	/**
	 * 读取配置前先处理 env 文件：撤销上一轮注入的变量，
	 * 重新解析 .env / .env.local 并注入（不覆盖进程原有的键）。
	 */
	override async readConfig(initial = false) {
		// 先撤销上一轮由 env 文件注入的变量
		revertEnv(this.localKeys);

		// 解析各 env 文件（后者覆盖前者）并注入，记录注入的键以便下轮撤销
		const parsed = await parseEnvFiles(this.envFiles);
		this.localKeys = injectEnv(parsed);

		return await super.readConfig(initial);
	}

	/**
	 * 按名称导入插件：ns-require 解析出模块路径（结果缓存），
	 * 再以 require() 加载 CJS 产物；解析失败仅记录错误并返回 undefined。
	 */
	override async import(name: string) {
		try {
			this.cache[name] ||= this.scope.resolve(name);
		} catch (err) {
			logger.error(err instanceof Error ? err.message : err);
			return;
		}
		return require(this.cache[name]);
	}

	/**
	 * 整进程重载：先把共享数据发回父守护进程（供重启后的新进程继承），
	 * 再以约定退出码退出，由父进程负责重新拉起。
	 */
	override fullReload(code = Loader.exitCode) {
		const body = JSON.stringify(this.envData);
		// 规避 @types/node 的类型问题：
		// https://github.com/DefinitelyTyped/DefinitelyTyped/discussions/74275
		process.send?.({ type: "shared", body }, (err: any) => {
			if (err) logger.error("failed to send shared data");
			logger.info("trigger full reload");
			process.exit(code);
		});
	}
}
