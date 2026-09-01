// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * NodeLoader 的清单迁移：把历史上的内置功能改写为对应插件的形式，
 * 并同步维护 package.json 依赖表。
 */

import { type Dict, Logger } from "@koishi-ce/core";

const logger = new Logger("app");

/** package.json 的最小结构（迁移只关心依赖表） */
interface PackageManifest {
	dependencies?: Dict<string | undefined>;
}

/**
 * 解析 koishi 元包的 manifest 路径。
 * 候选顺序：本组织 @koishi-ce/koishi 优先，兼容上游原名 koishi；
 * 全部落空时返回 undefined（此时迁移仅跳过依赖版本登记，不告警）。
 */
function resolveManifest(): string | undefined {
	for (const name of ["@koishi-ce/koishi", "koishi"]) {
		try {
			return Bun.resolveSync(`${name}/package.json`, import.meta.dir);
		} catch {}
	}
	return undefined;
}

/**
 * 配置文件级迁移：把历史上的内置功能改写为插件形式。
 *
 * 迁移项：request 配置 → http 插件；内置代理 → proxy-agent 插件；
 * 顶层的 port/host/maxPort/selfUrl → server 插件。
 * 同时把新增插件的依赖写入 package.json（失败仅告警，不阻断启动）。
 *
 * 注：package.json 按进程工作目录读写（保持历史行为）；
 * 依赖版本取自 koishi 元包的依赖表（按 loader 自身位置解析）。
 */
export async function migrateManifest(config: Dict<unknown>) {
	try {
		let isDirty = false;
		const meta = (await Bun.file("package.json").json()) as PackageManifest;
		const manifest = resolveManifest();
		const deps = manifest
			? ((await Bun.file(manifest).json()) as PackageManifest).dependencies
			: undefined;
		meta.dependencies ??= {};
		const dependencies = meta.dependencies;
		/** 登记一个依赖并标记 package.json 已变更（版本未知时跳过登记） */
		function addDep(name: string) {
			const version = deps?.[name];
			if (!version) return;
			dependencies[name] = version;
			isDirty = true;
		}

		// 旧的全局 request 配置改写为 http 插件
		if (!meta.dependencies["@koishi-ce/plugin-http"]) {
			const { request = {} } = config;
			delete config["request"];
			config["plugins"] = {
				http: request,
				...(config["plugins"] as Record<string, unknown>),
			};
			addDep("@koishi-ce/plugin-http");
		}

		// 补挂 proxy-agent 插件（旧版代理能力已拆分为插件）
		if (!meta.dependencies["@koishi-ce/plugin-proxy-agent"]) {
			config["plugins"] = {
				"proxy-agent": {},
				...(config["plugins"] as Record<string, unknown>),
			};
			addDep("@koishi-ce/plugin-proxy-agent");
		}

		/** 从插件表（含嵌套 group）中提取 http 插件的 proxyAgent 配置并移除 */
		function getProxyAgent(plugins: Dict<unknown>): unknown {
			for (const [key, value] of Object.entries(plugins)) {
				const name = key.replace(/^~/, "").split(":")[0];
				let result: unknown;
				if (name === "http") {
					const config = value as Dict<unknown> | null | undefined;
					result = config?.["proxyAgent"];
					delete config?.["proxyAgent"];
				} else if (name === "group") {
					result = getProxyAgent((value ?? {}) as Dict<unknown>);
				}
				if (result) return result;
			}
			return undefined;
		}

		/** 将提取到的 proxyAgent 写回 proxy-agent 插件配置 */
		function setProxyAgent(plugins: Dict<unknown>): boolean | undefined {
			for (const [key, value] of Object.entries(plugins)) {
				const name = key.replace(/^~/, "").split(":")[0];
				if (name === "proxy-agent") {
					plugins[key] = { ...(value as Dict<unknown>), proxyAgent };
					return true;
				} else if (name === "group") {
					const result = setProxyAgent((value ?? {}) as Dict<unknown>);
					if (result) return result;
				}
			}
			return undefined;
		}

		// http.proxyAgent 迁移为 proxy-agent 插件的配置
		const proxyAgent = getProxyAgent(
			(config["plugins"] ?? {}) as Dict<unknown>,
		);
		if (proxyAgent) setProxyAgent(config["plugins"] as Dict<unknown>);

		// 旧的服务器顶层配置（端口等）改写为 server 插件
		if (config["port"]) {
			const { port, host, maxPort, selfUrl } = config;
			delete config["port"];
			delete config["host"];
			delete config["maxPort"];
			delete config["selfUrl"];
			config["plugins"] = {
				server: { port, host, maxPort, selfUrl },
				...(config["plugins"] as Record<string, unknown>),
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
			await Bun.write("package.json", `${JSON.stringify(meta, null, 2)}\n`);
		}
	} catch (error) {
		logger.warn("failed to migrate manifest");
		logger.warn(error);
	}
}
