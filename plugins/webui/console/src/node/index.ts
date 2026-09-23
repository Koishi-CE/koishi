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
 *
 * 大块实现已拆至同层模块（类内保留薄委托，行为不变）：
 * - schema.ts：Dev / Head / Config 三个 Schema 常量；
 * - vite.ts：Vite 开发服务器创建与 HMR 端口探测；
 * - assets.ts：静态资源路由、index.html 处理与 entry 文件解析。
 */

import { existsSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { Console, type Entry } from "@koishi-ce/console";
import {
	type Context,
	type Dict,
	makeArray,
	type Schema,
	type Universal,
} from "@koishi-ce/koishi";
import type { WebSocketLayer } from "@koishi-ce/plugin-server";
import type {} from "@koishijs/plugin-server-proxy";
import open from "open";
import type {
	FileSystemServeOptions,
	ViteDevServer,
} from "vite";
import { getFiles, registerAssets } from "./assets.ts";
import { rewriteSharedImports } from "./rewrite.ts";
import {
	ConfigSchema,
	DevSchema,
	HeadSchema,
} from "./schema.ts";
import { createDevServer } from "./vite.ts";

// 上游此处以 `declare module "koishi"` 给 EnvData 增加 clientCount 字段；
// 本仓 @koishi-ce/core 将 EnvData 定义为 type alias（无法做 interface 合并），
// 且 loader 的 envData 实际类型为推断的 any，故该增强在本仓无落点，不再声明。

export * from "@koishi-ce/console";
// 裸导入改写工具（原文件内实现，独立成纯函数模块；此处转出保持公开面）
export {
	rewriteSharedImports,
	SHARED_IMPORT_MAP,
} from "./rewrite.ts";

/**
 * 定位前端产物目录（包根下的 dist）：从模块所在目录向上找到首个含
 * package.json 的目录。不能用固定的相对层数——产物中本模块会被 rolldown
 * 拆至 lib/ 一层（lib/node/index.mjs 仅为壳），相对 import.meta.url 的层级
 * 随 chunk 落点漂移，曾致 root 指向包外而 index.html 404。
 */
function findDistRoot(from: string): string {
	let dir = from;
	while (dir !== dirname(dir)) {
		if (existsSync(join(dir, "package.json"))) {
			return join(dir, "dist");
		}
		dir = dirname(dir);
	}
	return join(from, "../dist");
}

/** 浏览器端全局配置 KOISHI_CONFIG 的形状（createGlobal 生成后注入 index.html）。 */
export interface ClientConfig {
	devMode: boolean;
	uiPath: string;
	endpoint: string;
	static?: boolean;
	heartbeat?: HeartbeatConfig;
	proxyBase?: string;
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

		// devMode 下 root 指向宿主 SPA 源码（@koishi-ce/console-app 的
		// src/ 目录，由 vite 现场编译）；生产模式指向本包 dist/
		// （总装产物已就位）。包名与子路径须与 builder 的 locateApp()
		// （packages/web/builder/src/app.ts）保持一致
		this.root = config.devMode
			? resolve(
					Bun.resolveSync(
						"@koishi-ce/console-app/package.json",
						import.meta.dir,
					),
					"../src",
				)
			: findDistRoot(import.meta.dir);
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
			devMode = Bun.env["NODE_ENV"] === "development",
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
				!Bun.env["KOISHI_AGENT"]
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

	/**
	 * 把 entry 的本地文件列表解析为浏览器可请求的 URL 列表：
	 * devMode 走 Vite 的 /vite/@fs/ 绝对路径，生产模式走
	 * `uiPath + /@plugin-key` 由 serveAssets 落盘回读。
	 */
	resolveEntry(files: Entry.Files, key: string) {
		const { devMode, uiPath } = this.config;
		const filenames: string[] = [];
		for (const local of makeArray(
			getFiles(files, devMode),
		)) {
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
	 * 注册控制台前端的静态资源路由（实现在 assets.ts 的 registerAssets）。
	 * transformImport 为类私有方法，经闭包显式传入。
	 */
	private serveAssets() {
		registerAssets(this, (source) =>
			this.transformImport(source),
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
	 * 创建 Vite 开发服务器并桥接到 server
	 * （实现在 vite.ts 的 createDevServer），插件卸载时关闭服务器。
	 */
	private async createVite() {
		this.vite = await createDevServer(
			this.ctx,
			this.config,
		);
	}

	/** 停止服务：关闭 WebSocket 层。 */
	override stop() {
		this.layer.close();
	}

	// erasableSyntaxOnly 禁止含运行时值的 namespace：以下三个 Schema 常量（定义
	// 在 schema.ts）改挂为类的静态属性（NodeConsole.Dev / NodeConsole.Head /
	// NodeConsole.Config 的取值不变），类型声明保留在文末仅含类型的 namespace
	// 中，以维持 `NodeConsole.Config` 等的类型访问
	static Dev: Schema<NodeConsole.Dev> = DevSchema;
	static Head: Schema<NodeConsole.Head> = HeadSchema;
	static Config: Schema<NodeConsole.Config> = ConfigSchema;
}

namespace NodeConsole {
	/** Vite 开发服务器的文件访问控制（fs.strict / allow / deny）、域名放行（allowedHosts）与热更新 WebSocket 端口（wsPort）。 */
	export interface Dev {
		fs: FileSystemServeOptions;
		allowedHosts?: string[];
		wsPort?: number;
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
