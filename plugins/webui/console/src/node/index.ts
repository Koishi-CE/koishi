import { Console, type Entry } from "@koishi-ce/console";
import {
	type Context,
	type Dict,
	h,
	makeArray,
	noop,
	Schema,
	Time,
} from "@koishi-ce/koishi";
import type { WebSocketLayer } from "@koishi-ce/plugin-server";
import {} from "@koishijs/plugin-server-proxy";
import { createReadStream, existsSync, promises as fs, type Stats } from "fs";
import { createRequire } from "module";
import open from "open";
import { extname, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import type { FileSystemServeOptions, ViteDevServer } from "vite";

// 上游此处以 `declare module "koishi"` 给 EnvData 增加 clientCount 字段；
// 本仓 @koishi-ce/core 将 EnvData 定义为 type alias（无法做 interface 合并），
// 且 loader 的 envData 实际类型为推断的 any，故该增强在本仓无落点，不再声明。

export * from "@koishi-ce/console";

export interface ClientConfig {
	devMode: boolean;
	uiPath: string;
	endpoint: string;
	static?: boolean;
	heartbeat?: HeartbeatConfig;
	proxyBase?: string;
}

interface HeartbeatConfig {
	interval?: number;
	timeout?: number;
}

class NodeConsole extends Console {
	static override inject = { required: ["server"], optional: ["console"] };
	// static inject = ['server']

	// workaround for edge case (collision with @koishi-ce/plugin-config)
	private _config!: NodeConsole.Config;

	public vite!: ViteDevServer;
	public root: string;
	public layer: WebSocketLayer;

	override ctx: Context;

	constructor(ctx: Context, config: NodeConsole.Config) {
		super(ctx);
		this.ctx = ctx;
		this.config = config;

		this.layer = ctx.server.ws(config.apiPath ?? "/status", (socket) => {
			// @types/ws does not provide typings for `dispatchEvent`
			this.accept(socket as any);
		});

		ctx.on("console/connection", () => {
			const loader = ctx.get("loader");
			if (!loader) return;
			loader.envData.clientCount = this.layer.clients.size;
		});

		const base = import.meta.url || pathToFileURL(__filename).href;
		const require = createRequire(base);
		this.root = config.devMode
			? resolve(require.resolve("@koishi-ce/client/package.json"), "../app")
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
		if (heartbeat !== undefined) global.heartbeat = heartbeat;
		global.endpoint = selfUrl + apiPath;
		const proxy = this.ctx.get("server.proxy");
		if (proxy) global.proxyBase = proxy.config.path + "/";
		return global;
	}

	override async start() {
		if (this.config.devMode) await this.createVite();
		this.serveAssets();

		this.ctx.on("server/ready", () => {
			let { host, port } = this.ctx.server;
			if (["0.0.0.0", "::"].includes(host)) host = "127.0.0.1";
			const target = `http://${host}:${port}${this.config.uiPath}`;
			if (
				this.config.open &&
				!this.ctx.get("loader")?.envData.clientCount &&
				!process.env["KOISHI_AGENT"]
			) {
				// 打开浏览器失败无需处理，显式忽略返回的 Promise
				void open(target);
			}
			this.ctx.logger.info("webui is available at %c", target);
		});
	}

	private getFiles(files: Entry.Files) {
		if (typeof files === "string" || Array.isArray(files)) return files;
		if (!this.config.devMode) return files.prod;
		if (!existsSync(files.dev)) return files.prod;
		return files.dev;
	}

	resolveEntry(files: Entry.Files, key: string) {
		const { devMode, uiPath } = this.config;
		const filenames: string[] = [];
		for (const local of makeArray(this.getFiles(files))) {
			const filename = devMode
				? "/vite/@fs/" + local
				: uiPath + "/@plugin-" + key;
			if (extname(local)) {
				filenames.push(filename);
			} else {
				filenames.push(filename + "/index.js");
				if (existsSync(local + "/style.css")) {
					filenames.push(filename + "/style.css");
				}
			}
		}
		return filenames;
	}

	private serveAssets() {
		const { uiPath = "" } = this.config;

		this.ctx.server.get(uiPath + "(.*)", async (ctx, next) => {
			await next();
			if (ctx.body || ctx.response.body) return;

			// add trailing slash and redirect
			if (ctx.path === uiPath && !uiPath.endsWith("/")) {
				return ctx.redirect(ctx.path + "/");
			}

			const name = ctx.path.slice(uiPath.length).replace(/^\/+/, "");
			const sendFile = (filename: string) => {
				ctx.type = extname(filename);
				return (ctx.body = createReadStream(filename));
			};

			if (name.startsWith("@plugin-")) {
				const [key] = name.slice(8).split("/", 1);
				if (key !== undefined && this.entries[key]) {
					const files = makeArray(this.getFiles(this.entries[key].files));
					let filename = files[0] + name.slice(8 + key.length);
					filename = resolve(this.root, filename);
					if (
						!filename.startsWith(this.root) &&
						!filename.includes("node_modules")
					) {
						return (ctx.status = 403);
					}
					ctx.type = extname(filename);
					if (this.config.devMode || ctx.type !== "application/javascript") {
						return sendFile(filename);
					}

					// we only transform js imports in production mode
					const source = await fs.readFile(filename, "utf8");
					return (ctx.body = await this.transformImport(source));
				} else {
					return (ctx.status = 404);
				}
			}

			const filename = resolve(this.root, name);
			if (
				!filename.startsWith(this.root) &&
				!filename.includes("node_modules")
			) {
				return (ctx.status = 403);
			}

			const stats = await fs.stat(filename).catch<Stats>(noop);
			if (stats?.isFile()) return sendFile(filename);
			const template = await fs.readFile(
				resolve(this.root, "index.html"),
				"utf8",
			);
			ctx.type = "html";
			ctx.body = await this.transformHtml(template);
		});
	}

	private async transformImport(source: string) {
		let output = "";
		let cap: RegExpExecArray | null;
		while (
			(cap = /((?:^|;)import\b[^'"]+\bfrom\s*)(['"])([^'"]+)\2;/m.exec(source))
		) {
			const [stmt, left, quote, path] = cap;
			output +=
				source.slice(0, cap.index) +
				left +
				quote +
				({
					vue: "../vue.js",
					"vue-router": "../vue-router.js",
					"@vueuse/core": "../vueuse.js",
					"@koishi-ce/client": "../client.js",
				}[path ?? ""] ?? path) +
				quote +
				";";
			source = source.slice(cap.index + stmt.length);
		}
		return output + source;
	}

	private async transformHtml(template: string) {
		const { uiPath = "", head = [] } = this.config;
		if (this.vite) {
			template = await this.vite.transformIndexHtml(uiPath, template);
		} else {
			template = template.replace(
				/(href|src)="(?=\/)/g,
				(_, $1) => `${$1}="${uiPath}`,
			);
		}
		let headInjection = `<script>KOISHI_CONFIG = ${JSON.stringify(this.createGlobal())}</script>`;
		for (const { tag, attrs = {}, content } of head) {
			const attrString = Object.entries(attrs)
				.map(([key, value]) => ` ${key}="${h.escape(value ?? "", true)}"`)
				.join("");
			headInjection += `<${tag}${attrString}>${content ?? ""}</${tag}>`;
		}
		return template.replace("<title>", headInjection + "<title>");
	}

	private async createVite() {
		const { cacheDir = "cache/vite", dev } = this.config;
		const { createServer } =
			require("@koishi-ce/client/lib") as typeof import("@koishi-ce/client/lib");

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

	override stop() {
		this.layer.close();
	}

	// erasableSyntaxOnly 禁止含运行时值的 namespace：以下三个 Schema 常量改挂为类的静态属性
	// （NodeConsole.Dev / NodeConsole.Head / NodeConsole.Config 的取值不变），
	// 类型声明保留在文末仅含类型的 namespace 中，以维持 `NodeConsole.Config` 等的类型访问
	// biome-ignore lint/style/useNamingConvention: 插件 Schema 约定为 PascalCase 的静态属性（与类型 namespace 同名合并）
	static Dev: Schema<NodeConsole.Dev> = Schema.object({
		fs: Schema.object({
			strict: Schema.boolean().default(true),
			// .default(null) 的空值占位超出 schemastery 类型定义，用精确断言放宽
			allow: Schema.array(String).default(null as never),
			deny: Schema.array(String).default(null as never),
		}).hidden(),
	});

	// biome-ignore lint/style/useNamingConvention: 插件 Schema 约定为 PascalCase 的静态属性（与类型 namespace 同名合并）
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

	// biome-ignore lint/style/useNamingConvention: 插件 Schema 约定为 PascalCase 的静态属性（与类型 namespace 同名合并）
	static Config: Schema<NodeConsole.Config> = Schema.intersect([
		Schema.object({
			uiPath: Schema.string().default(""),
			apiPath: Schema.string().default("/status"),
			selfUrl: Schema.string().role("link").default(""),
			open: Schema.boolean(),
			head: Schema.array(NodeConsole.Head),
			heartbeat: Schema.object({
				interval: Schema.number().default(Time.second * 30),
				timeout: Schema.number().default(Time.minute),
			}),
			devMode: Schema.boolean()
				.default(process.env["NODE_ENV"] === "development")
				.hidden(),
			cacheDir: Schema.string().default("cache/vite").hidden(),
			dev: NodeConsole.Dev,
		}),
	]).i18n({
		"zh-CN": require("../../locales/zh-CN"),
	});
}

namespace NodeConsole {
	export interface Dev {
		fs: FileSystemServeOptions;
	}

	export interface Head {
		tag: string;
		attrs?: Dict<string>;
		content?: string;
	}

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
