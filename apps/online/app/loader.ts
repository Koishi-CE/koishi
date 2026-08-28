/**
 * 浏览器版插件加载器：把 Koishi 的 loader 机制（Node 侧的插件装配器）
 * 搬进浏览器，是 k-on! 在线运行时的核心。
 *
 * 关键链路（PPA 在线化）：prepare() 从注册表（生产环境即
 * registry.koishi.chat，开发环境为本站 dev 服务器）拉取 portable.json
 * 市场索引，为每个可用插件建立"短名 -> 在线模块 URL"缓存；import()
 * 时按短名查缓存并动态 import 对应 URL——插件代码本体不随站点发布，
 * 全部在线加载。
 *
 * 默认导出全局唯一实例，由 socket.ts 在连接建立后驱动，
 * utils.ts 借助它完成实例的初始化与应用创建。
 */
import { global } from "@koishi-ce/client";
import { Logger } from "@koishi-ce/core";
import { Loader } from "@koishi-ce/loader";
import type { SearchResult } from "@koishi-ce/registry";
import { Buffer } from "buffer";
import process from "process";

export * from "@koishi-ce/loader";

// 部分在线模块（koishi / cordis 系）引用全局 process 与 Buffer：
// 生产产物不含 Node 垫片，由这里统一挂载；开发态 Vite 已注入，
// 跳过以免覆盖
if (process.env.NODE_ENV !== "development") {
	globalThis.process = process;
	globalThis.Buffer = Buffer;
}

/**
 * Loader 的浏览器实现。
 *
 * 与 Node 版 loader 的差异：插件不在磁盘上，而是来自注册表的在线模块；
 * 配置与数据的持久化由 utils.ts 借助虚拟文件系统（@cordiverse/fs 垫片）
 * 完成。
 */
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

	/** 初始化加载器：先走父类流程，再预取注册表索引回填 market 缓存。 */
	async init(filename?: string) {
		await super.init(filename);
		await this.prepare();
	}

	/**
	 * 预取在线插件索引：拉取注册表的 portable.json，并把每个插件的完整
	 * 包名压缩为短名（去掉 koishi- / @koishijs/plugin- 前缀）作为缓存键，
	 * 值为 <endpoint>/modules/<包名>/index.js 形式的在线模块 URL。
	 * 此后 import(短名) 即可加载对应插件。
	 */
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

	/**
	 * 按短名加载在线插件模块（父类插件装配流程的调用点）。
	 *
	 * @param name 插件短名（prepare 建立的缓存键）
	 * @returns 模块导出对象；短名不在缓存中或加载失败时返回
	 *          undefined（失败仅在控制台告警，不中断装配）
	 */
	async import(name: string) {
		const specifier = this.cache[name];
		if (!specifier) return;
		try {
			return await import(/* @vite-ignore */ specifier);
		} catch (err) {
			console.warn(err);
		}
	}

	/** 整站重载回调：Node loader 中会重启进程，浏览器侧仅打印日志占位。 */
	fullReload() {
		console.info("trigger full reload");
	}
}

// 全局唯一实例：socket.ts 建立连接后由它驱动整个浏览器内运行时
export default new BrowserLoader();
