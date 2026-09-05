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

import { arch, cpus, platform, release } from "node:os";
import { DataService } from "@koishi-ce/console";
import {
	type Context,
	type Dict,
	Schema,
	version,
} from "@koishi-ce/koishi";

class EnvInfoProvider extends DataService<
	Dict<Dict<string>>
> {
	/** 采集任务的缓存：get() 首次调用时创建，之后始终复用同一 Promise。 */
	private task!: Promise<Dict<Dict<string>>>;

	// 基类链（cordis Service）上已有 config 成员，故需 override
	override config: EnvInfoProvider.Config;

	constructor(
		ctx: Context,
		config: EnvInfoProvider.Config,
	) {
		super(ctx, "envinfo");
		this.config = config;
	}

	/** 执行一次实际采集：系统信息、运行时版本、Koishi 生态版本。 */
	async _get(): Promise<Dict<Dict<string>>> {
		// 不再依赖 npm 包 envinfo / which-pm-runs：OS 由 platform +
		// release + arch 原生拼出，CPU 取 cpus() 首核型号；Bun-first
		// 下包管理器恒为 bun（唯一启动方式），直接上报其版本
		const system: Dict<string> = {
			OS: `${platform()} ${release()} ${arch()}`,
			CPU: cpus()[0]?.model.trim() ?? "",
		};
		const binaries: Dict<string> = {
			Node: process.versions.node,
			Bun: Bun.version,
		};
		// 不直接 require package.json 是为了避免其被模块缓存固定住，
		// 热更新后读取到的仍是旧版本号
		const metapath = require.resolve(
			"@koishi-ce/console/package.json",
		);
		const meta = await Bun.file(metapath)
			.text()
			.then(JSON.parse);
		const koishi: Dict<string> = {
			Core: version,
			Console: meta.version,
		};
		// 宿主代理（如 koishi-plugin-browser）可通过该环境变量上报自身名称与版本
		if (Bun.env["KOISHI_AGENT"]) {
			const [name, agentVersion] =
				Bun.env["KOISHI_AGENT"].split("/");
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
	static Config: Schema<EnvInfoProvider.Config> =
		Schema.object({});
}

namespace EnvInfoProvider {
	export type Config = Record<never, never>;
}

export default EnvInfoProvider;
