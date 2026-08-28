import { DataService } from "@koishi-ce/console";
import { type Context, type Dict, Schema, version } from "@koishi-ce/koishi";
import { helpers } from "envinfo";
import { readFile } from "fs/promises";
import { whichPMRuns } from "which-pm-runs";

class EnvInfoProvider extends DataService<Dict<Dict<string>>> {
	private task!: Promise<Dict<Dict<string>>>;

	// 基类链（cordis Service）上已有 config 成员，故需 override
	override config: EnvInfoProvider.Config;

	constructor(ctx: Context, config: EnvInfoProvider.Config) {
		super(ctx, "envinfo");
		this.config = config;
	}

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
			if (agent.name === "yarn") {
				agent.name = "Yarn";
			}
			binaries[agent.name] = agent.version;
		}
		// do not use `require` directly to avoid caching
		const metapath = require.resolve("@koishi-ce/console/package.json");
		const meta = await readFile(metapath, "utf8").then(JSON.parse);
		const koishi: Dict<string> = {
			Core: version,
			Console: meta.version,
		};
		if (process.env["KOISHI_AGENT"]) {
			const [name, agentVersion] = process.env["KOISHI_AGENT"].split("/");
			if (name && agentVersion) {
				koishi[name] = agentVersion;
			}
		}
		return { system, binaries, koishi };
	}

	override async get() {
		if (!this.task) this.task = this._get();
		return this.task;
	}

	// erasableSyntaxOnly 禁止含运行时值的 namespace，
	// 原 namespace 内的 Config 常量移到此处的静态字段，对外形状不变
	// biome-ignore lint/style/useNamingConvention: 插件 Schema 约定为 PascalCase 的 Config 静态属性
	static Config: Schema<EnvInfoProvider.Config> = Schema.object({});
}

namespace EnvInfoProvider {
	export type Config = {};
}

export default EnvInfoProvider;
