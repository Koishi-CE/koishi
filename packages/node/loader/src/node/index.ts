/**
 * NodeLoader：Loader 的 Bun/Node 环境实现。
 *
 * 相比基类，它补充了五块能力：
 * - 借助 Bun.resolveSync 解析 `koishi-plugin-*` 插件的实际路径并以
 *   require 加载（Bun 的 require 可直接加载 ESM/TS，解析规则见 resolve.ts）；
 * - 加载插件前预置依赖链的 CJS interop 种子（Bun 把 exports 的 "bun"
 *   条件用在 require 上导致 ESM 入口分歧的修复，见 interop.ts）；
 * - 读取 .env / .env.local 并注入 process.env（记录注入键避免污染宿主
 *   环境，实现见 env.ts）；
 * - 配置文件的平台 I/O（定位 / 解析 / 原子写回，见 config-file.ts）；
 * - 历史配置迁移：把旧版内置功能（request、代理、服务器端口等）
 *   改写为对应插件的形式，并同步维护 package.json 依赖表（实现见 migration.ts）。
 *
 * 与运行环境无关的抽象基类见 base/，公共出口见 shared.ts。
 */

import { resolve } from "node:path";
import { type Dict, Logger } from "@koishi-ce/core";
import type { ResolvedConfigFile } from "../base/config-file.ts";
import Loader from "../base/index.ts";
import { locateConfig, parseConfig, saveConfig } from "./config-file.ts";
import { injectEnv, parseEnvFiles, revertEnv } from "./env.ts";
import { seedCjsInterop } from "./interop.ts";
import { migrateManifest } from "./migration.ts";
import { resolvePlugin } from "./resolve.ts";

export { Loader } from "../base/index.ts";
export type { LoaderScope, SharedData, StartMessage } from "../base/types.ts";
export { unwrapExports } from "../base/utils.ts";

const logger = new Logger("app");

// 把 Bun require 登记的脚本扩展名（.js / .ts / .mts 等）并入受支持集合，
// 使脚本文件也能作为配置文件显式传入
for (const key in require.extensions) {
	Loader.extensions.add(key);
}

export default class NodeLoader extends Loader {
	/** 由 env 文件注入 process.env 的键（重读配置前先撤销） */
	public localKeys: string[] = [];

	override async init(filename?: string) {
		await super.init(filename);
		this.envFiles = [
			resolve(this.baseDir, ".env"),
			resolve(this.baseDir, ".env.local"),
		];
	}

	protected override locateConfig(
		baseDir: string,
		filename?: string,
	): Promise<ResolvedConfigFile> {
		return locateConfig(baseDir, filename);
	}

	protected override parseConfig(
		filename: string,
		mime: string | undefined,
	): Promise<unknown> {
		return parseConfig(filename, mime);
	}

	protected override saveConfig(
		filename: string,
		config: Dict<unknown>,
		mime: string | undefined,
	): Promise<void> {
		return saveConfig(filename, config, mime);
	}

	/**
	 * 迁移旧版数据库插件配置：
	 * - mysql/mongo/postgres：补默认数据库名 koishi；
	 * - sqlite：补默认数据库路径 data/koishi.db。
	 * 其余交给基类处理。
	 */
	override migrateEntry(name: string, config: Dict<unknown> | undefined) {
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
		await migrateManifest(this.config as unknown as Dict<unknown>);
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
	 * 按名称导入插件：先解析出模块绝对路径（结果缓存），再以 require
	 * 加载——Bun 的 require 可直接加载 ESM / TS 产物，且模块进入
	 * require.cache，hmr 插件的模块图分析与缓存失效据此工作。
	 * 加载前先经 seedCjsInterop 预置依赖链的 CJS interop 种子（"bun"
	 * 导出条件导致 Bun require 命中 ESM 入口的分歧修复，见 interop.ts）。
	 * 解析失败仅记录错误并返回 undefined。
	 */
	override async import(name: string) {
		let filename: string;
		try {
			filename = this.cache[name] ??= resolvePlugin(name, this.baseDir);
		} catch (err) {
			logger.error(err instanceof Error ? err.message : err);
			return;
		}
		seedCjsInterop(filename);
		return require(filename);
	}

	/**
	 * 整进程重载：先把共享数据发回父守护进程（供重启后的新进程继承），
	 * 再以约定退出码退出，由父进程负责重新拉起。
	 */
	override fullReload(code = Loader.exitCode) {
		const body = JSON.stringify(this.envData);
		process.send?.({ type: "shared", body }, (err) => {
			if (err) logger.error("failed to send shared data");
			logger.info("trigger full reload");
			process.exit(code);
		});
	}
}
