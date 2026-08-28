/**
 * NodeLoader 的清单迁移：把历史上的内置功能改写为对应插件的形式，
 * 并同步维护 package.json 依赖表。
 */

import { type Dict, Logger } from "@koishi-ce/core";
import { promises as fs } from "fs";
import { createRequire } from "module";

const logger = new Logger("app");

/**
 * 配置文件级迁移：把历史上的内置功能改写为插件形式。
 *
 * 迁移项：request 配置 → http 插件；内置代理 → proxy-agent 插件；
 * 顶层的 port/host/maxPort/selfUrl → server 插件。
 * 同时把新增插件的依赖写入 package.json（失败仅告警，不阻断启动）。
 *
 * 注：package.json 按进程工作目录读写（保持历史行为）。
 */
export async function migrateManifest(config: Dict) {
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
			const { request = {} } = config;
			delete config["request"];
			config["plugins"] = {
				http: request,
				...config["plugins"],
			};
			addDep("@koishi-ce/plugin-http");
		}

		// 补挂 proxy-agent 插件（旧版代理能力已拆分为插件）
		if (!meta.dependencies["@koishi-ce/plugin-proxy-agent"]) {
			config["plugins"] = {
				"proxy-agent": {},
				...config["plugins"],
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
		const proxyAgent = getProxyAgent(config["plugins"] ?? {});
		if (proxyAgent) setProxyAgent(config["plugins"] ?? {});

		// 旧的服务器顶层配置（端口等）改写为 server 插件
		const legacy = config;
		if (legacy["port"]) {
			const { port, host, maxPort, selfUrl } = legacy;
			delete legacy["port"];
			delete legacy["host"];
			delete legacy["maxPort"];
			delete legacy["selfUrl"];
			config["plugins"] = {
				server: { port, host, maxPort, selfUrl },
				...config["plugins"],
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
			await fs.writeFile("package.json", `${JSON.stringify(meta, null, 2)}\n`);
		}
	} catch (error) {
		logger.warn("failed to migrate manifest");
		logger.warn(error);
	}
}
