/**
 * NodeLoader：Loader 的 Node 环境实现。
 *
 * 相比基类，它补充了三块能力：
 * - 借助 ns-require 解析 `koishi-plugin-*` 插件的实际路径并以 require() 加载；
 * - 读取 .env / .env.local 并注入 process.env（记录注入键避免污染宿主环境）；
 * - 历史配置迁移：把旧版内置功能（request、代理、服务器端口等）
 *   改写为对应插件的形式，并同步维护 package.json 依赖表。
 */

import { type Dict, Logger } from "@koishi-ce/core";
import * as dotenv from "dotenv";
import { promises as fs } from "fs";
import { createRequire } from "module";
import ns from "ns-require";
import Loader from "./shared";

export * from "./shared";

const logger = new Logger("app");

// eslint-disable-next-line n/no-deprecated-api
for (const key in require.extensions) {
	Loader.extensions.add(key);
}

/** 进程启动时即已存在的环境变量键（env 文件不得覆盖这些键） */
const initialKeys = Object.getOwnPropertyNames(process.env);

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

	/**
	 * 配置文件级迁移：把历史上的内置功能改写为插件形式。
	 *
	 * 迁移项：request 配置 → http 插件；内置代理 → proxy-agent 插件；
	 * 顶层的 port/host/maxPort/selfUrl → server 插件。
	 * 同时把新增插件的依赖写入 package.json（失败仅告警，不阻断启动）。
	 */
	override async migrate() {
		try {
			let isDirty = false;
			const meta = JSON.parse(await fs.readFile("package.json", "utf8"));
			const require = createRequire(__filename);
			const deps = require("koishi/package.json").dependencies;

			meta.dependencies ||= {};
			/** 登记一个依赖并标记 package.json 已变更 */
			function addDep(name: string) {
				meta.dependencies[name] = deps[name];
				isDirty = true;
			}

			// 旧的全局 request 配置改写为 http 插件
			if (!meta.dependencies["@koishi-ce/plugin-http"]) {
				const { request = {} } = this.config as any;
				delete this.config["request"];
				this.config.plugins = {
					http: request,
					...this.config.plugins,
				};
				addDep("@koishi-ce/plugin-http");
			}

			// 补挂 proxy-agent 插件（旧版代理能力已拆分为插件）
			if (!meta.dependencies["@koishi-ce/plugin-proxy-agent"]) {
				this.config.plugins = {
					"proxy-agent": {},
					...this.config.plugins,
				};
				addDep("@koishi-ce/plugin-proxy-agent");
			}

			/** 从插件表（含嵌套 group）中提取 http 插件的 proxyAgent 配置并移除 */
			function getProxyAgent(plugins: Dict) {
				for (const [key, value] of Object.entries(plugins)) {
					const name = key.replace(/^~/, "").split(":")[0];
					let result: any;
					if (name === "http") {
						result = value?.proxyAgent;
						delete value.proxyAgent;
					} else if (name === "group") {
						result = getProxyAgent(value);
					}
					if (result) return result;
				}
			}

			/** 将提取到的 proxyAgent 写回 proxy-agent 插件配置 */
			function setProxyAgent(plugins: Dict): boolean | undefined {
				for (const [key, value] of Object.entries(plugins)) {
					const name = key.replace(/^~/, "").split(":")[0];
					if (name === "proxy-agent") {
						plugins[key] = { ...value, proxyAgent };
						return true;
					} else if (name === "group") {
						const result = setProxyAgent(value);
						if (result) return result;
					}
				}
				return undefined;
			}

			// http.proxyAgent 迁移为 proxy-agent 插件的配置
			const proxyAgent = getProxyAgent(this.config.plugins ?? {});
			if (proxyAgent) setProxyAgent(this.config.plugins ?? {});

			// 旧的服务器顶层配置（端口等）改写为 server 插件
			const legacy = this.config as Dict;
			if (legacy["port"]) {
				const { port, host, maxPort, selfUrl } = legacy;
				delete legacy["port"];
				delete legacy["host"];
				delete legacy["maxPort"];
				delete legacy["selfUrl"];
				this.config.plugins = {
					server: { port, host, maxPort, selfUrl },
					...this.config.plugins,
				};
				addDep("@koishi-ce/plugin-server");
			}

			// 有变更则按字典序重排依赖并回写 package.json
			if (isDirty) {
				meta.dependencies = Object.fromEntries(
					Object.entries(meta.dependencies).sort(([a], [b]) =>
						a.localeCompare(b),
					),
				);
				await fs.writeFile(
					"package.json",
					JSON.stringify(meta, null, 2) + "\n",
				);
			}
		} catch (error) {
			logger.warn("failed to migrate manifest");
			logger.warn(error);
		}

		await super.migrate();
	}

	/**
	 * 读取配置前先处理 env 文件：撤销上一轮注入的变量，
	 * 重新解析 .env / .env.local 并注入（不覆盖进程原有的键）。
	 */
	override async readConfig(initial = false) {
		// 先撤销上一轮由 env 文件注入的变量
		for (const key of this.localKeys) {
			delete process.env[key];
		}

		// 解析各 env 文件（后者覆盖前者）
		const parsed: Dict<string> = {};
		for (const filename of this.envFiles) {
			try {
				const raw = await fs.readFile(filename, "utf8");
				Object.assign(parsed, dotenv.parse(raw));
			} catch {}
		}

		// 注入 env 文件变量，记录注入的键以便下轮撤销
		this.localKeys = [];
		for (const key in parsed) {
			if (initialKeys.includes(key)) continue;
			process.env[key] = parsed[key];
			this.localKeys.push(key);
		}

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
