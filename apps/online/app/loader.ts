import { global } from "@koishi-ce/client";
import { Logger } from "@koishi-ce/core";
import { Loader } from "@koishi-ce/loader";
import type { SearchResult } from "@koishi-ce/registry";
import { Buffer } from "buffer";
import process from "process";

export * from "@koishi-ce/loader";

if (process.env.NODE_ENV !== "development") {
	globalThis.process = process;
	globalThis.Buffer = Buffer;
}

class BrowserLoader extends Loader {
	// loader 机制（如 koishi.socket）会在运行时向实例挂载 symbol 键
	[key: symbol]: unknown;

	public envData: any = {};
	public config: any = { plugins: {} };
	// 由 init() -> prepare() 异步回填
	public market!: SearchResult;

	constructor() {
		Logger.targets = [];
		super();
	}

	async init(filename?: string) {
		await super.init(filename);
		await this.prepare();
	}

	private async prepare() {
		this.market = await fetch(global.endpoint + "/portable.json").then((res) =>
			res.json(),
		);
		for (const object of this.market.objects) {
			const shortname = object.package.name.replace(
				/(koishi-|^@koishijs\/)plugin-/,
				"",
			);
			this.cache[shortname] =
				`${global.endpoint}/modules/${object.package.name}/index.js`;
		}
	}

	async import(name: string) {
		const specifier = this.cache[name];
		if (!specifier) return;
		try {
			return await import(/* @vite-ignore */ specifier);
		} catch (err) {
			console.warn(err);
		}
	}

	fullReload() {
		console.info("trigger full reload");
	}
}

export default new BrowserLoader();
