// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 运行环境信息服务（服务名 "envinfo"）。
 *
 * 一次性采集系统与运行时版本信息，整理为 { system, binaries, koishi }
 * 三组分节字符串字典，供控制台前端在状态栏展示与一键复制。
 * 环境信息在进程生命周期内不会变化，因此采集结果以 Promise 形式永久缓存。
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { DataService } from "@koishi-ce/console";
import { type Context, type Dict, Schema, version } from "@koishi-ce/koishi";
import { helpers } from "envinfo";

// 经 createRequire 加载 CJS 包并就地断言签名：不走 ESM 导入互操作，
// 规避多包合并类型检查（大一统 tsconfig）下 export = 交织失效问题
// （此前具名导入在 Bun 运行时下本就拿不到具名导出，属顺带修复）
const whichPMRuns = createRequire(import.meta.url)("which-pm-runs") as () =>
	| undefined
	| { name: string; version: string };

class EnvInfoProvider extends DataService<Dict<Dict<string>>> {
	/** 采集任务的缓存：get() 首次调用时创建，之后始终复用同一 Promise。 */
	private task!: Promise<Dict<Dict<string>>>;

	// 基类链（cordis Service）上已有 config 成员，故需 override
	override config: EnvInfoProvider.Config;

	constructor(ctx: Context, config: EnvInfoProvider.Config) {
		super(ctx, "envinfo");
		this.config = config;
	}

	/** 执行一次实际采集：系统信息、运行时版本、Koishi 生态版本。 */
	async _get(): Promise<Dict<Dict<string>>> {
		// @types/envinfo 把各 helper 声明为 Promise<string>，运行时实际返回
		// [标题, 值] 二元组；解构默认值仅用于收窄类型，正常路径不会触发
		const [[, Os = ""], [, Cpu = ""]] = await Promise.all([
			helpers.getOSInfo(),
			helpers.getCPUInfo(),
		]);
		const agent = whichPMRuns();
		const system: Dict<string> = { OS: Os, CPU: Cpu };
		const binaries: Dict<string> = {
			Node: process.versions.node,
		};
		if (agent) {
			// yarn 的名称归一为首字母大写，与 Node 等键的展示风格一致
			if (agent.name === "yarn") {
				agent.name = "Yarn";
			}
			binaries[agent.name] = agent.version;
		}
		// 不直接 require package.json 是为了避免其被模块缓存固定住，
		// 热更新后读取到的仍是旧版本号
		const metapath = require.resolve("@koishi-ce/console/package.json");
		const meta = await readFile(metapath, "utf8").then(JSON.parse);
		const koishi: Dict<string> = {
			Core: version,
			Console: meta.version,
		};
		// 宿主代理（如 koishi-plugin-browser）可通过该环境变量上报自身名称与版本
		if (process.env["KOISHI_AGENT"]) {
			const [name, agentVersion] = process.env["KOISHI_AGENT"].split("/");
			if (name && agentVersion) {
				koishi[name] = agentVersion;
			}
		}
		return { system, binaries, koishi };
	}

	/** 首次调用时发起采集并缓存 Promise，后续调用直接返回同一结果。 */
	override async get() {
		if (!this.task) this.task = this._get();
		return this.task;
	}

	// erasableSyntaxOnly 禁止含运行时值的 namespace，
	// 原 namespace 内的 Config 常量移到此处的静态字段，对外形状不变
	static Config: Schema<EnvInfoProvider.Config> = Schema.object({});
}

namespace EnvInfoProvider {
	export type Config = Record<never, never>;
}

export default EnvInfoProvider;
