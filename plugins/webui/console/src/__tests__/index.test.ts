// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * @koishi-ce/plugin-console（NodeConsole 宿主插件）的行为测试。
 *
 * 以 vendored 的 @koishi-ce/plugin-server 起真实 HTTP/WS 服务
 * （127.0.0.1 + 随机探测端口，用完即停），覆盖：
 * - WebSocket 接入（/status）与前端 RPC（ping / 未知事件）、连接数同步；
 * - 静态资源托管：SPA 回退 index.html、KOISHI_CONFIG 注入、head 标签注入、
 *   uiPath 重定向、产物文件改写与路径穿越防护（403/404）；
 * - resolveEntry 在 prod / devMode 两种模式下的文件解析；
 * - createGlobal 的心跳与代理前缀装配；start 的 open 行为与 stop 收尾。
 */
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	App,
	Logger,
	type Plugin,
} from "@koishi-ce/koishi";
import type {
	ClientConfig,
	Entry,
} from "@koishi-ce/plugin-console";
import Server, {
	type WebSocketLayer,
} from "@koishi-ce/plugin-server";

// 先行拦截 open：open: true 分支不应真的拉起浏览器
const openCalls: string[] = [];
mock.module("open", () => ({
	default: (target: string) => {
		openCalls.push(target);
		return Promise.resolve();
	},
}));
// devMode 分支的 Vite 服务器以最小桩替代（真实 Vite 不在测试范围），
// 桩记录 close 调用与 createServer 传参，并由 /vite 桥接中间件直接应答
let viteClosed = false;
const viteConfigs: {
	server?: { allowedHosts?: string[] };
}[] = [];
mock.module("@koishi-ce/client/lib", () => ({
	createServer: async (
		_baseDir: string,
		config: unknown,
	) => {
		viteConfigs.push(
			config as { server?: { allowedHosts?: string[] } },
		);
		return {
			middlewares: (
				_req: unknown,
				res: { end(body: string): void },
				next: () => void,
			) => {
				res.end("vite-ok");
				next();
			},
			close: () => {
				viteClosed = true;
			},
		};
	},
}));
// mock 就位后再加载被测插件（静态导入会抢在 mock 之前绑定真实模块）
const { default: NodeConsole } = await import(
	"@koishi-ce/plugin-console"
);

/** NodeConsole 上测试需要触达的成员视图（resolveEntry 为 protected 实现） */
interface HostView {
	config: { devMode?: boolean };
	resolveEntry(files: Entry.Files, key: string): string[];
	createGlobal(): ClientConfig;
	vite?: unknown;
}

/** 探测一个当前空闲的端口（进程内即刻释放，server 的 listen 自带 +1 兜底） */
async function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = net.createServer();
		probe.listen(0, "127.0.0.1", () => {
			const { port } = probe.address() as net.AddressInfo;
			probe.close(() => resolve(port));
		});
		probe.on("error", reject);
	});
}

/** 建立 WebSocket 并等待打开完成（Bun 内建 WebSocket 客户端） */
function openSocket(url: string) {
	return new Promise<WebSocket>((resolve, reject) => {
		const socket = new WebSocket(url);
		socket.addEventListener("open", () => resolve(socket));
		socket.addEventListener("error", () =>
			reject(new Error("ws failed")),
		);
	});
}

interface WsMessage {
	type: string;
	body: unknown;
}

/** 收集一条 WebSocket 消息（带超时保护） */
function nextMessage(socket: WebSocket, timeout = 2000) {
	return new Promise<WsMessage>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("ws message timeout")),
			timeout,
		);
		socket.addEventListener(
			"message",
			(event) => {
				clearTimeout(timer);
				resolve(
					JSON.parse(String(event.data)) as WsMessage,
				);
			},
			{ once: true },
		);
	});
}

/** 等待并过滤出满足条件的首条消息 */
async function waitForMessage(
	socket: WebSocket,
	pred: (data: WsMessage) => boolean,
	timeout = 2000,
) {
	const deadline = Date.now() + timeout;
	for (;;) {
		const remaining = deadline - Date.now();
		if (remaining <= 0)
			throw new Error("ws message timeout");
		const data = await nextMessage(socket, remaining);
		if (pred(data)) return data;
	}
}

/** 以原始 TCP 报文发送 HTTP 请求（保留 .. 等不被客户端规范化的路径） */
function rawRequest(port: number, path: string) {
	return new Promise<string>((resolve, reject) => {
		const socket = net.connect(port, "127.0.0.1", () => {
			socket.write(
				`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`,
			);
		});
		let buffer = "";
		socket.on("data", (chunk) => {
			buffer += chunk.toString();
		});
		socket.on("end", () => resolve(buffer));
		socket.on("error", reject);
	});
}

const port = await freePort();
const app = new App();
app.plugin(Server, {
	host: "127.0.0.1",
	port,
	maxPort: port + 100,
});
// NodeConsole 的 static Config（Schema.intersect）与 plugin 重载的 Transform
// 推断不合（cordis 3 旧形态），断言为 Constructor 后配置参数恢复宽收
app.plugin(
	NodeConsole as unknown as Plugin.Constructor<App>,
	{
		uiPath: "/console",
		apiPath: "/status",
		open: true,
		head: [
			{ tag: "meta", attrs: { charset: "utf-8" } },
			{
				tag: "script",
				content: "console.log('head-injected')",
			},
		],
		heartbeat: { interval: 30000, timeout: 60000 },
	},
);

let base = "";

beforeAll(async () => {
	// listening/available/closing 与 unknown message 均为生命周期 info，收敛为仅错误级
	const levels = Logger.levels as Record<string, number>;
	levels["server"] = 1;
	levels["console"] = 1;
	await app.start();
	base = `http://127.0.0.1:${app.server.port}`;
});

afterAll(async () => {
	await app.stop();
	const levels = Logger.levels as Record<string, number>;
	delete levels["server"];
	delete levels["console"];
});

describe("@koishi-ce/plugin-console（NodeConsole）", () => {
	describe("WebSocket 通道", () => {
		it("客户端经 /status 接入并完成首屏同步", async () => {
			const socket = await openSocket(
				`ws://127.0.0.1:${app.server.port}/status`,
			);
			const data = await waitForMessage(
				socket,
				(msg) =>
					msg.type === "data" &&
					(msg.body as { key?: string }).key === "entry",
			);
			const value = (
				data.body as { value: { _id: string } }
			).value;
			expect(typeof value._id).toBe("string");
			await socket.close();
		});

		it("ping 探活与未知事件回执", async () => {
			const socket = await openSocket(
				`ws://127.0.0.1:${app.server.port}/status`,
			);
			await waitForMessage(
				socket,
				(msg) =>
					msg.type === "data" &&
					(msg.body as { key?: string }).key === "entry",
			);
			socket.send(
				JSON.stringify({ type: "ping", id: 1, args: [] }),
			);
			const pong = await waitForMessage(
				socket,
				(msg) => msg.type === "response",
			);
			expect(pong.body).toEqual({ id: 1, value: "pong" });
			socket.send(
				JSON.stringify({
					type: "no-such-event",
					id: 2,
					args: [],
				}),
			);
			const miss = await waitForMessage(
				socket,
				(msg) => msg.type === "response",
			);
			expect(miss.body).toEqual({
				id: 2,
				error: "not implemented",
			});
			await socket.close();
		});

		it("连接数变化同步到 loader.envData.clientCount", async () => {
			const envData: { clientCount?: number } = {};
			app.provide("loader", { envData });
			expect(envData.clientCount).toBeUndefined();

			const socket = await openSocket(
				`ws://127.0.0.1:${app.server.port}/status`,
			);
			await waitForMessage(
				socket,
				(msg) =>
					msg.type === "data" &&
					(msg.body as { key?: string }).key === "entry",
			);
			expect(envData.clientCount).toBe(1);
			await socket.close();
			// 断开后连接数归零
			await new Promise((resolve) =>
				setTimeout(resolve, 50),
			);
			expect(envData.clientCount).toBe(0);
		});
	});

	describe("静态资源托管", () => {
		it("访问 uiPath 本身重定向到带尾斜杠地址", async () => {
			const response = await fetch(`${base}/console`, {
				redirect: "manual",
			});
			expect(response.status).toBe(302);
			expect(response.headers.get("location")).toBe(
				"/console/",
			);
			await response.arrayBuffer();
		});

		it("根路径回退 index.html 并注入 KOISHI_CONFIG 与 head 标签", async () => {
			const response = await fetch(`${base}/console/`);
			expect(response.status).toBe(200);
			const html = await response.text();
			expect(html).toContain("<title>");
			expect(html).toContain("KOISHI_CONFIG = ");
			expect(html).toContain('"uiPath":"/console"');
			expect(html).toContain('"endpoint":"/status"');
			expect(html).toContain('"devMode":false');
			expect(html).toContain('"heartbeat"');
			expect(html).toContain('<meta charset="utf-8">');
			expect(html).toContain(
				"<script>console.log('head-injected')</script>",
			);
		});

		it("未命中的路径回退 index.html（SPA 路由）", async () => {
			const response = await fetch(
				`${base}/console/some/spa/route`,
			);
			expect(response.status).toBe(200);
			const html = await response.text();
			expect(html).toContain("KOISHI_CONFIG");
		});

		it("已存在的主体文件直接下发", async () => {
			const response = await fetch(
				`${base}/console/logo.png`,
			);
			expect(response.status).toBe(200);
			const buffer = await response.arrayBuffer();
			expect(buffer.byteLength).toBeGreaterThan(0);
		});

		it("vite 就绪时 transformHtml 交给 vite 处理", async () => {
			const host = app.console as unknown as HostView;
			// 以最小桩覆盖 vite 分支（真实 Vite 服务器不在测试范围）
			host.vite = {
				transformIndexHtml: async (
					_path: string,
					template: string,
				) => `${template}<!--vite-->`,
			};
			const response = await fetch(`${base}/console/`);
			const html = await response.text();
			expect(html).toContain("<!--vite-->");
			host.vite = undefined;
		});
	});

	describe("插件产物（@plugin-*）", () => {
		it("按 entry 声明下发产物文件并改写裸导入", async () => {
			const dir = join(
				tmpdir(),
				`koishi-console-test-${Date.now()}`,
			);
			await mkdir(dir, { recursive: true });
			await writeFile(
				join(dir, "index.js"),
				'import { ref } from "vue";\nimport { x } from "@koishi-ce/client";\nexport const a = ref(1);\n',
			);
			await writeFile(
				join(dir, "style.css"),
				"body{margin:0}",
			);

			const host = app.console as unknown as HostView;
			const entry = app.console.addEntry({
				dev: join(dir, "dev.ts"),
				prod: dir,
			});
			expect(host.resolveEntry(dir, entry.id)).toEqual([
				`/console/@plugin-${entry.id}/index.js`,
				`/console/@plugin-${entry.id}/style.css`,
			]);

			const js = await fetch(
				`${base}/console/@plugin-${entry.id}/index.js`,
			);
			expect(js.status).toBe(200);
			const source = await js.text();
			// 生产模式下裸导入改写到宿主共享模块
			expect(source).toContain('from "../vue.js"');
			expect(source).toContain('from "../client.js"');

			const css = await fetch(
				`${base}/console/@plugin-${entry.id}/style.css`,
			);
			expect(css.status).toBe(200);
			expect(await css.text()).toContain("margin:0");
			entry.dispose();
		});

		it("未知 entry 或空文件表返回 404", async () => {
			const missing = await fetch(
				`${base}/console/@plugin-nosuchkey/index.js`,
			);
			expect(missing.status).toBe(404);
			await missing.arrayBuffer();

			const entry = app.console.addEntry([]);
			const empty = await fetch(
				`${base}/console/@plugin-${entry.id}/index.js`,
			);
			expect(empty.status).toBe(404);
			await empty.arrayBuffer();
			entry.dispose();
		});

		it("产物路径穿越被拒绝（403）", async () => {
			const dir = join(
				tmpdir(),
				`koishi-console-test-sec-${Date.now()}`,
			);
			await mkdir(dir, { recursive: true });
			await writeFile(join(dir, "index.js"), "export {}");
			const entry = app.console.addEntry({
				dev: join(dir, "dev.ts"),
				prod: dir,
			});

			const raw = await rawRequest(
				app.server.port,
				`/console/@plugin-${entry.id}/../secret.js`,
			);
			expect(raw).toContain(" 403 ");
			entry.dispose();
		});

		it("主体资源路径穿越被拒绝（403）", async () => {
			const raw = await rawRequest(
				app.server.port,
				"/console/../../secret.txt",
			);
			expect(raw).toContain(" 403 ");
		});
	});

	describe("resolveEntry 与 getFiles", () => {
		it("devMode 下走 /vite/@fs 绝对路径，dev 缺失时回退 prod 文件", async () => {
			const host = app.console as unknown as HostView;
			host.config.devMode = true;

			// dev 路径存在（以真实临时文件保证 existsSync 为真）
			const dir = join(
				tmpdir(),
				`koishi-console-test-dev-${Date.now()}`,
			);
			await mkdir(join(dir, "src"), { recursive: true });
			await writeFile(
				join(dir, "src", "dev-entry.ts"),
				"export {}",
			);
			const devFile = join(dir, "src", "dev-entry.ts");

			// 先取全部结果再恢复配置，避免断言失败时污染后续用例
			const results = {
				// 带扩展名：直接使用文件本身
				file: host.resolveEntry(devFile, "k1"),
				// 目录：追加 index.js；无 style.css 时不下发样式
				dir: host.resolveEntry(join(dir, "src"), "k2"),
				// devMode 下 dev 路径不存在时回退 prod 的文件清单（URL 前缀仍按 devMode）
				fallback: host.resolveEntry(
					{ dev: "/nonexistent/dev.ts", prod: "p.js" },
					"k3",
				),
				// 字符串与数组声明在任何模式下原样使用
				single: host.resolveEntry("single.js", "k4"),
				list: host.resolveEntry(["a.js", "b.js"], "k5"),
			};
			host.config.devMode = false;

			expect(results.file).toEqual([
				`/vite/@fs/${devFile}`,
			]);
			expect(results.dir).toEqual([
				`/vite/@fs/${join(dir, "src")}/index.js`,
			]);
			expect(results.fallback).toEqual(["/vite/@fs/p.js"]);
			expect(results.single).toEqual([
				"/vite/@fs/single.js",
			]);
			expect(results.list).toEqual([
				"/vite/@fs/a.js",
				"/vite/@fs/b.js",
			]);
		});

		it("prod 模式下统一指向 @plugin-<key>，目录形态补 index.js", () => {
			const host = app.console as unknown as HostView;
			expect(host.resolveEntry("file.js", "k6")).toEqual([
				"/console/@plugin-k6",
			]);
			expect(host.resolveEntry("/some/dir", "k7")).toEqual([
				"/console/@plugin-k7/index.js",
			]);
		});
	});

	describe("createGlobal", () => {
		it("装配端点、心跳与代理前缀", () => {
			const host = app.console as unknown as HostView;
			const global = host.createGlobal();
			expect(global.devMode).toBe(false);
			expect(global.uiPath).toBe("/console");
			expect(global.endpoint).toBe("/status");
			expect(global.heartbeat).toEqual({
				interval: 30000,
				timeout: 60000,
			});
			// 未部署代理服务时不带 proxyBase
			expect(global.proxyBase).toBeUndefined();

			// 提供代理服务后带上前缀
			app.provide("server.proxy", {
				config: { path: "/proxy" },
			});
			expect(host.createGlobal().proxyBase).toBe("/proxy/");
		});
	});

	describe("启动与停止", () => {
		it("open: true 时以访问地址调用 open（本测试已 mock）", () => {
			expect(openCalls).toHaveLength(1);
			expect(openCalls[0]).toContain("http://127.0.0.1:");
			expect(openCalls[0]).toContain("/console");
		});

		it("config 存取器直读直写", () => {
			const host = app.console as unknown as HostView;
			const original = host.config;
			const probe = { ...original, devMode: true };
			host.config = probe;
			expect(host.config.devMode).toBe(true);
			host.config = original;
			expect(host.config.devMode).toBe(false);
		});

		it("stop 关闭 WebSocket 层", async () => {
			const localPort = await freePort();
			const localApp = new App();
			localApp.plugin(Server, {
				host: "127.0.0.1",
				port: localPort,
				maxPort: localPort + 100,
			});
			localApp.plugin(
				NodeConsole as unknown as Plugin.Constructor<App>,
				{
					apiPath: "/status",
				},
			);
			await localApp.start();
			const server = localApp.server;
			const layer = (
				localApp.console as unknown as {
					layer: WebSocketLayer;
				}
			).layer;
			expect(server.wsStack).toHaveLength(1);
			expect(server.wsStack.includes(layer)).toBe(true);
			await localApp.stop();
			// 层被摘除，监听端口随 app 一并释放
			expect(server.wsStack).toHaveLength(0);
		});
	});

	describe("devMode 集成（Vite 以桩替代）", () => {
		const devApp = new App();
		let devBase = "";

		beforeAll(async () => {
			const devPort = await freePort();
			devApp.plugin(Server, {
				host: "127.0.0.1",
				port: devPort,
				maxPort: devPort + 100,
			});
			devApp.plugin(
				NodeConsole as unknown as Plugin.Constructor<App>,
				{
					devMode: true,
					dev: {
						fs: { strict: true },
						allowedHosts: ["example.com"],
					},
					cacheDir: "cache/vite-test",
				},
			);
			await devApp.start();
			devBase = `http://127.0.0.1:${devApp.server.port}`;
		});

		it("构造期以 client 包定位 root，并桥接 /vite 请求", async () => {
			const host = devApp.console as unknown as HostView & {
				root: string;
			};
			// root 指向 @koishi-ce/client 包内的 app 目录（devMode 分支）
			expect(host.root.replace(/\\/g, "/")).toContain(
				"/app",
			);
			const response = await fetch(
				`${devBase}/vite/anything`,
			);
			expect(await response.text()).toBe("vite-ok");
		});

		it("dev.allowedHosts 透传到 Vite 的 server 配置", () => {
			const config = viteConfigs.at(-1);
			expect(config?.server?.allowedHosts).toEqual([
				"example.com",
			]);
		});

		it("停机时关闭 Vite 服务器并释放端口", async () => {
			await devApp.stop();
			expect(viteClosed).toBe(true);
		});
	});
});
