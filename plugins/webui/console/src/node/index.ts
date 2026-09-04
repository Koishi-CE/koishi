// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * console 宿主插件（node 侧，NodeConsole）。
 *
 * 在 Node 环境驱动网页控制台的完整服务端链路：
 * - 在 server 上建立 WebSocket 层（默认 /status），把每个连接交给
 *   基类 Console 作为 Client 管理；
 * - 托管控制台前端静态资源（plugins/webui/console/dist），按 entry 配置
 *   提供 @plugin-* 插件产物，生产模式下重写裸导入并注入 KOISHI_CONFIG；
 * - devMode 下另起 Vite 开发服务器（/vite 路径）实现插件前端热更新。
 */

import {
	createReadStream,
	existsSync,
	promises as fs,
	type Stats,
} from "node:fs";
import { createRequire } from "node:module";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Console, type Entry } from "@koishi-ce/console";
import {
	type Context,
	type Dict,
	h,
	makeArray,
	noop,
	Schema,
	Time,
	type Universal,
} from "@koishi-ce/koishi";
import type { WebSocketLayer } from "@koishi-ce/plugin-server";
import type {} from "@koishijs/plugin-server-proxy";
import open from "open";
import type {
	FileSystemServeOptions,
	ViteDevServer,
} from "vite";
import deDE from "../../locales/de-DE.yml";
import enUS from "../../locales/en-US.yml";
import frFR from "../../locales/fr-FR.yml";
import jaJP from "../../locales/ja-JP.yml";
import ruRU from "../../locales/ru-RU.yml";
import zhCN from "../../locales/zh-CN.yml";
import zhTW from "../../locales/zh-TW.yml";

// 上游此处以 `declare module "koishi"` 给 EnvData 增加 clientCount 字段；
// 本仓 @koishi-ce/core 将 EnvData 定义为 type alias（无法做 interface 合并），
// 且 loader 的 envData 实际类型为推断的 any，故该增强在本仓无落点，不再声明。

export * from "@koishi-ce/console";

/** 浏览器端全局配置 KOISHI_CONFIG 的形状（createGlobal 生成后注入 index.html）。 */
export interface ClientConfig {
	devMode: boolean;
	uiPath: string;
	endpoint: string;
	static?: boolean;
	heartbeat?: HeartbeatConfig;
	proxyBase?: string;
}

/**
 * 插件产物 JS 中的裸包名到宿主控制台共享模块的改写映射。
 * `@koishijs/client` 与 `@koishi-ce/client` 同源，供市场安装的上游官方
 * webui 插件（其产物裸导入上游包名）复用同一份共享 chunk。
 */
export const SHARED_IMPORT_MAP: Record<string, string> = {
	vue: "../vue.js",
	"vue-router": "../vue-router.js",
	"@vueuse/core": "../vueuse.js",
	"@koishi-ce/client": "../client.js",
	"@koishijs/client": "../client.js",
};

/**
 * 把插件产物 JS 中的裸导入改写为宿主共享模块的相对路径。
 * 产物由 vite/rolldown 压缩生成，导入语句的形态不止 `import … from`
 * 一种，以下形态都必须覆盖，否则浏览器端会以裸名直接加载而失败：
 * - `import { x } from "vue"` / `import x from "vue"`（含压缩后无空格形态）
 * - `import "vue"`（无绑定名的副作用导入，如插件只注册路由）
 * - `export { x } from "vue"` / `export * from "vue"`（再导出）
 * - `import("vue")`（动态导入）
 * 映射之外的说明符（相对路径、其他依赖）原样保留。
 */
export function rewriteSharedImports(source: string) {
	// 前导边界：import/export 关键字前必须是语句边界字符（行首、;、}、
	// 空白、括号等），不能紧跟引号或标识符字符——否则字符串字面量里
	// 恰好出现的 "import … from 'vue'" 文案也会被误改写
	const boundary = String.raw`(?:^|[^\w.'"])`;
	const rewrite = (
		stmt: string,
		left: string,
		quote: string,
		spec: string,
		right = "",
	) => {
		const target = SHARED_IMPORT_MAP[spec];
		return target === undefined
			? stmt
			: left + quote + target + quote + right;
	};
	return source
		.replace(
			new RegExp(
				`(${boundary}(?:\\bimport|\\bexport)\\b[^;'"]*?\\bfrom\\s*)(["'])([^"']+)\\2`,
				"g",
			),
			(stmt, left: string, quote: string, spec: string) =>
				rewrite(stmt, left, quote, spec),
		)
		.replace(
			new RegExp(
				`(${boundary}\\bimport\\s*)(["'])([^"']+)\\2(?=\\s*[;\\n])`,
				"g",
			),
			(stmt, left: string, quote: string, spec: string) =>
				rewrite(stmt, left, quote, spec),
		)
		.replace(
			new RegExp(
				`(${boundary}\\bimport\\(\\s*)(["'])([^"']+)\\2(\\s*\\))`,
				"g",
			),
			(
				stmt,
				left: string,
				quote: string,
				spec: string,
				right: string,
			) => rewrite(stmt, left, quote, spec, right),
		);
}

/** WebSocket 心跳配置（间隔与超时时间）。 */
interface HeartbeatConfig {
	interval?: number;
	timeout?: number;
}

/**
 * Node 环境下的控制台服务：WebSocket 通道、静态资源托管、Vite 开发
 * 集成与打开浏览器等均在构造器 / start() 中完成，详见文件头说明。
 */
class NodeConsole extends Console {
	static override inject = {
		required: ["server"],
		optional: ["console"],
	};
	// static inject = ['server']

	// 规避与 @koishi-ce/plugin-config 的碰撞 edge case 的临时持有字段
	private _config!: NodeConsole.Config;

	public vite!: ViteDevServer;
	public root: string;
	public layer: WebSocketLayer;

	override ctx: Context;

	constructor(ctx: Context, config: NodeConsole.Config) {
		super(ctx);
		this.ctx = ctx;
		this.config = config;

		this.layer = ctx.server.ws(
			config.apiPath ?? "/status",
			(socket, request) => {
				// @types/ws 未为 `dispatchEvent` 提供类型声明，
				// ws 的 WebSocket 与 Universal.WebSocket 结构不一致，故经 unknown 双重断言
				this.accept(
					socket as unknown as Universal.WebSocket,
					request,
				);
			},
		);

		// 连接数变化时同步到 loader.envData，供 koishi-scripts 等外部工具感知
		ctx.on("console/connection", () => {
			const loader = ctx.get("loader");
			if (!loader) return;
			loader.envData.clientCount = this.layer.clients.size;
		});

		const base =
			import.meta.url || pathToFileURL(__filename).href;
		const require = createRequire(base);
		this.root = config.devMode
			? resolve(
					require.resolve("@koishi-ce/client/package.json"),
					"../app",
				)
			: fileURLToPath(new URL("../../dist", base));
	}

	// 基类（cordis Service）将 config 声明为数据属性，而这里需要存取器间接持有
	// （workaround：规避与 @koishi-ce/plugin-config 的碰撞 edge case）；
	// TS 语言规则禁止存取器覆盖基类数据属性（运行时合法），只能在此抑制
	// @ts-expect-error TS2611: 存取器不能覆盖基类的数据属性 config
	override get config() {
		return this._config;
	}

	override set config(value) {
		this._config = value;
	}

	/**
	 * 生成注入浏览器的全局配置 KOISHI_CONFIG：
	 * 开发模式标记、控制台路径、WebSocket endpoint、心跳参数与代理前缀。
	 */
	createGlobal() {
		const global = {} as ClientConfig;
		// 解构默认值与 Config Schema 的 default 保持一致（正常路径下 Schema 已填充，此处仅为类型兜底）
		const {
			devMode = process.env["NODE_ENV"] === "development",
			uiPath = "",
			apiPath = "/status",
			selfUrl = "",
			heartbeat,
		} = this.config;
		global.devMode = devMode;
		global.uiPath = uiPath;
		if (heartbeat !== undefined)
			global.heartbeat = heartbeat;
		global.endpoint = selfUrl + apiPath;
		const proxy = this.ctx.get("server.proxy");
		if (proxy) global.proxyBase = `${proxy.config.path}/`;
		return global;
	}

	/**
	 * 启动控制台：devMode 下先创建 Vite 开发服务器，再注册静态资源路由；
	 * server 就绪后按配置打开浏览器（无已有连接且非代理进程时）并输出访问地址。
	 */
	override async start() {
		if (this.config.devMode) await this.createVite();
		this.serveAssets();

		this.ctx.on("server/ready", () => {
			let { host, port } = this.ctx.server;
			if (["0.0.0.0", "::"].includes(host))
				host = "127.0.0.1";
			const target = `http://${host}:${port}${this.config.uiPath}`;
			if (
				this.config.open &&
				!this.ctx.get("loader")?.envData.clientCount &&
				!process.env["KOISHI_AGENT"]
			) {
				// 打开浏览器失败无需处理，显式忽略返回的 Promise
				void open(target);
			}
			this.ctx.logger.info(
				"webui is available at %c",
				target,
			);
		});
	}

	/** 取 entry 在当前模式下实际使用的文件列表：按 devMode 与 dev 路径是否存在回退。 */
	private getFiles(files: Entry.Files) {
		if (typeof files === "string" || Array.isArray(files))
			return files;
		if (!this.config.devMode) return files.prod;
		if (!existsSync(files.dev)) return files.prod;
		return files.dev;
	}

	/**
	 * 把 entry 的本地文件列表解析为浏览器可请求的 URL 列表：
	 * devMode 走 Vite 的 /vite/@fs/ 绝对路径，生产模式走
	 * `uiPath + /@plugin-key` 由 serveAssets 落盘回读。
	 */
	resolveEntry(files: Entry.Files, key: string) {
		const { devMode, uiPath } = this.config;
		const filenames: string[] = [];
		for (const local of makeArray(this.getFiles(files))) {
			const filename = devMode
				? `/vite/@fs/${local}`
				: `${uiPath}/@plugin-${key}`;
			if (extname(local)) {
				filenames.push(filename);
			} else {
				filenames.push(`${filename}/index.js`);
				// 早期发布的插件包样式产物名为 index.css，双名兼容探测
				const css = ["style.css", "index.css"].find(
					(name) => existsSync(resolve(local, name)),
				);
				if (css !== undefined) {
					filenames.push(`${filename}/${css}`);
				}
			}
		}
		return filenames;
	}

	/**
	 * 注册控制台前端的静态资源路由（挂在 uiPath 下）：
	 * - `@plugin-<key>/...`：各 webui 插件的产物文件；
	 * - 其余路径：控制台主体资源，未命中文件时回退 index.html（SPA 路由）；
	 * 插件产物的回读限制在其 entry 声明的产物路径内、主体资源限制在 root
	 * 内，以防路径穿越。
	 */
	private serveAssets() {
		const { uiPath = "" } = this.config;

		this.ctx.server.get(
			`${uiPath}(.*)`,
			async (ctx, next) => {
				await next();
				if (ctx.body || ctx.response.body) return;

				// 访问 uiPath 本身时补上末尾斜杠并重定向（保证相对路径资源正确解析）
				if (ctx.path === uiPath && !uiPath.endsWith("/")) {
					return ctx.redirect(`${ctx.path}/`);
				}

				const name = ctx.path
					.slice(uiPath.length)
					.replace(/^\/+/, "");
				// 发送产物文件：JS 统一过裸导入改写（devMode 下 npm 安装的插件同样
				// 会回退到产物 URL，不能按 devMode 短路直出），其余类型直出；
				// 文件缺失时如实 404，避免流错误或回退 HTML 干扰排查
				const sendAsset = async (filename: string) => {
					const type = extname(filename);
					if (type === ".js" || type === ".mjs") {
						const source = await fs
							.readFile(filename, "utf8")
							.catch(() => null);
						if (source === null) return (ctx.status = 404);
						ctx.type = type;
						return (ctx.body =
							await this.transformImport(source));
					}
					const stats = await fs
						.stat(filename)
						.catch<Stats>(noop);
					if (!stats?.isFile()) return (ctx.status = 404);
					ctx.type = type;
					return (ctx.body = createReadStream(filename));
				};

				if (name.startsWith("@plugin-")) {
					const [key] = name.slice(8).split("/", 1);
					if (key !== undefined && this.entries[key]) {
						const files = makeArray(
							this.getFiles(this.entries[key].files),
						);
						const file = files[0];
						if (file === undefined)
							return (ctx.status = 404);
						// 防路径穿越：产物只允许位于该 entry 自身声明的文件（或目录）之内。
						// 上游以 console root / node_modules 为白名单基准，前提是插件装在
						// node_modules 下；本仓库插件为 workspace 目录布局（plugins/**），
						// 须以各 entry 的产物路径为基准，否则一律 403。
						const base = resolve(file);
						const filename = resolve(
							file + name.slice(8 + key.length),
						);
						if (
							filename !== base &&
							!filename.startsWith(base + sep)
						) {
							return (ctx.status = 403);
						}
						// devMode 下 entry 的源码形态由 Vite 经 /vite/@fs 编译服务，
						// @plugin 通道只服务构建产物；误达的源码请求直接 404
						if (
							this.config.devMode &&
							/\.(ts|tsx|vue)$/.test(filename)
						) {
							return (ctx.status = 404);
						}
						return sendAsset(filename);
					} else {
						return (ctx.status = 404);
					}
				}

				const filename = resolve(this.root, name);
				if (
					filename !== this.root &&
					!filename.startsWith(this.root + sep) &&
					!filename.includes("node_modules")
				) {
					return (ctx.status = 403);
				}

				const stats = await fs
					.stat(filename)
					.catch<Stats>(noop);
				if (stats?.isFile()) return sendAsset(filename);

				// 控制台主体未命中时，再到各插件产物目录按文件名兜底：插件产物里的
				// worker / 分包可能以根绝对路径引用（如 monaco 的 /editor.worker-*.js），
				// 这类请求不带 @plugin- 前缀，会落到主体分支；产物文件名通常带内容
				// 哈希，按 basename 在各 entry 目录内探测不会产生跨插件混淆
				const base = name.split("/").pop() ?? "";
				if (base) {
					for (const entry of Object.values(this.entries)) {
						for (const dir of makeArray(
							this.getFiles(entry.files),
						)) {
							if (extname(dir)) continue; // 数组形态声明的是具体文件而非目录
							const root = resolve(String(dir));
							const candidate = resolve(root, base);
							if (
								candidate.startsWith(root + sep) &&
								existsSync(candidate)
							) {
								return sendAsset(candidate);
							}
						}
					}
				}

				// 带扩展名的资源请求未命中时如实 404：回退 index.html 会让浏览器把
				// HTML 当 JS / Worker 解析，报出更费解的语法错误
				if (extname(name)) return (ctx.status = 404);

				const template = await fs.readFile(
					resolve(this.root, "index.html"),
					"utf8",
				);
				ctx.type = "html";
				ctx.body = await this.transformHtml(template);
			},
		);
	}

	/**
	 * 改写插件产物 JS 中的裸导入：把 vue / vue-router / @vueuse/core /
	 * client 等共享依赖指向宿主控制台自带的共享模块（vue.js / client.js 等），
	 * 避免每个插件产物各打包一份运行时。实现见 {@link rewriteSharedImports}。
	 */
	private async transformImport(source: string) {
		return rewriteSharedImports(source);
	}

	/**
	 * 处理 index.html 模板：devMode 交给 Vite 注入开发脚本，生产模式把
	 * 根路径的 href/src 重写为 uiPath 前缀；随后在 <title> 前注入
	 * KOISHI_CONFIG 全局配置与配置项 head 中的自定义标签。
	 */
	private async transformHtml(template: string) {
		const { uiPath = "", head = [] } = this.config;
		if (this.vite) {
			template = await this.vite.transformIndexHtml(
				uiPath,
				template,
			);
		} else {
			template = template.replace(
				/(href|src)="(?=\/)/g,
				(_, $1) => `${$1}="${uiPath}`,
			);
		}
		let headInjection = `<script>KOISHI_CONFIG = ${JSON.stringify(this.createGlobal())}</script>`;
		for (const { tag, attrs = {}, content } of head) {
			const attrString = Object.entries(attrs)
				.map(
					([key, value]) =>
						` ${key}="${h.escape(value ?? "", true)}"`,
				)
				.join("");
			headInjection += `<${tag}${attrString}>${content ?? ""}</${tag}>`;
		}
		return template.replace(
			"<title>",
			`${headInjection}<title>`,
		);
	}

	/**
	 * 创建 Vite 开发服务器并桥接到 server：
	 * /vite 前缀的请求转交 Vite 中间件处理（含 /vite/@fs/ 的按需编译），
	 * 插件卸载时关闭服务器。
	 */
	private async createVite() {
		const { cacheDir = "cache/vite", dev } = this.config;
		// 惰性动态加载：避免生产环境（非 devMode）加载 vite 依赖
		const { createServer } = await import(
			"@koishi-ce/client/lib"
		);

		this.vite = await createServer(this.ctx.baseDir, {
			cacheDir: resolve(this.ctx.baseDir, cacheDir),
			...(dev ? { server: { fs: dev.fs } } : {}),
		});

		this.ctx.server.all(
			"/vite(.*)",
			(ctx) =>
				new Promise((resolve) => {
					this.vite.middlewares(ctx.req, ctx.res, resolve);
				}),
		);

		this.ctx.on("dispose", () => this.vite.close());
	}

	/** 停止服务：关闭 WebSocket 层。 */
	override stop() {
		this.layer.close();
	}

	// erasableSyntaxOnly 禁止含运行时值的 namespace：以下三个 Schema 常量改挂为类的静态属性
	// （NodeConsole.Dev / NodeConsole.Head / NodeConsole.Config 的取值不变），
	// 类型声明保留在文末仅含类型的 namespace 中，以维持 `NodeConsole.Config` 等的类型访问
	static Dev: Schema<NodeConsole.Dev> = Schema.object({
		fs: Schema.object({
			strict: Schema.boolean().default(true),
			// .default(null) 的空值占位超出 schemastery 类型定义，用精确断言放宽
			allow: Schema.array(String).default(null as never),
			deny: Schema.array(String).default(null as never),
		}).hidden(),
	});

	static Head: Schema<NodeConsole.Head> = Schema.intersect([
		Schema.object({
			tag: Schema.union([
				"title",
				"link",
				"meta",
				"script",
				"style",
				Schema.string(),
			]).required(),
		}),
		Schema.union([
			Schema.object({
				tag: Schema.const("title").required(),
				content: Schema.string().role("textarea"),
			}),
			Schema.object({
				tag: Schema.const("link").required(),
				attrs: Schema.dict(Schema.string()).role("table"),
			}),
			Schema.object({
				tag: Schema.const("meta").required(),
				attrs: Schema.dict(Schema.string()).role("table"),
			}),
			Schema.object({
				tag: Schema.const("script").required(),
				attrs: Schema.dict(Schema.string()).role("table"),
				content: Schema.string().role("textarea"),
			}),
			Schema.object({
				tag: Schema.const("style").required(),
				attrs: Schema.dict(Schema.string()).role("table"),
				content: Schema.string().role("textarea"),
			}),
			Schema.object({
				tag: Schema.string().required(),
				attrs: Schema.dict(Schema.string()).role("table"),
				content: Schema.string().role("textarea"),
			}),
		]),
	]);

	static Config: Schema<NodeConsole.Config> =
		Schema.intersect([
			Schema.object({
				uiPath: Schema.string().default(""),
				apiPath: Schema.string().default("/status"),
				selfUrl: Schema.string().role("link").default(""),
				open: Schema.boolean(),
				head: Schema.array(NodeConsole.Head),
				heartbeat: Schema.object({
					interval: Schema.number().default(
						Time.second * 30,
					),
					timeout: Schema.number().default(Time.minute),
				}),
				devMode: Schema.boolean()
					.default(
						process.env["NODE_ENV"] === "development",
					)
					.hidden(),
				cacheDir: Schema.string()
					.default("cache/vite")
					.hidden(),
				dev: NodeConsole.Dev,
			}),
		]).i18n({
			"de-DE": deDE,
			"en-US": enUS,
			"fr-FR": frFR,
			"ja-JP": jaJP,
			"ru-RU": ruRU,
			"zh-CN": zhCN,
			"zh-TW": zhTW,
		});
}

namespace NodeConsole {
	/** Vite 开发服务器的文件访问控制（fs.strict / allow / deny）。 */
	export interface Dev {
		fs: FileSystemServeOptions;
	}

	/** 注入 index.html 的自定义 head 标签（tag + attrs + content）。 */
	export interface Head {
		tag: string;
		attrs?: Dict<string>;
		content?: string;
	}

	/** 插件配置类型：路径、自述地址、心跳、devMode 与 head 注入等。 */
	export interface Config {
		uiPath?: string;
		devMode?: boolean;
		cacheDir?: string;
		open?: boolean;
		head?: Head[];
		selfUrl?: string;
		apiPath?: string;
		heartbeat?: HeartbeatConfig;
		dev?: Dev;
	}
}

export default NodeConsole;
