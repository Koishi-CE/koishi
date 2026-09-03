// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * @koishi-ce/console 服务端基座的行为测试。
 *
 * 以 TestConsole（Console 抽象基类的最小实现）+ FakeSocket（内存 WebSocket）
 * 驱动，覆盖：内置三数据服务的注册与读取、services 代理、客户端接入/断开、
 * RPC 分发（含鉴权拦截与错误回传）、广播、入口（Entry）生命周期、
 * DataService 的 refresh / patch 与 immediate 启动推送、宿主销毁时的清理。
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { IncomingMessage } from "node:http";
import {
	type Client,
	Console,
	DataService,
	type Entry,
	EntryProvider,
} from "@koishi-ce/console";
import {
	App,
	type Context,
	type Dict,
	Logger,
	makeArray,
	type Schema,
	type Universal,
} from "@koishi-ce/koishi";
// schema / permission 两个内置服务未从包出口再导出，走包内相对路径引用
import { PermissionProvider } from "../permission.ts";
import { SchemaProvider } from "../schema.ts";

// 声明测试专用事件，供 addListener / listeners 索引走类型化键
declare module "@koishi-ce/console" {
	interface Events {
		"test/echo"(...args: unknown[]): unknown[];
		"test/secret"(): string;
		"test/boom"(): never;
	}
}

/** 出站消息的统一形状（response / data / patch / entry-data） */
interface SentMessage {
	type: string;
	body: {
		id?: number | string;
		key?: string;
		value?: unknown;
		error?: string;
		data?: unknown;
	} & Record<string, unknown>;
}

/**
 * Console.get 下发的单个入口数据形状（以入口 id 为键的表项之一）。
 * src 侧 valueMap 展开后推断类型只剩 `_id`，测试按下发结构收窄后再索引。
 */
interface EntryItem {
	files: string[];
	paths?: string[];
	data: unknown;
}

/** 内存 WebSocket 桩：记录出站消息，可注入入站消息与 close 事件 */
class FakeSocket {
	sent: string[] = [];
	private messageHandlers = new Set<
		(event: Universal.WebSocket.MessageEvent) => void
	>();
	private closeHandlers = new Set<
		(event: Universal.WebSocket.CloseEvent) => void
	>();

	send(data: string) {
		this.sent.push(data);
	}

	addEventListener<K extends keyof Universal.WebSocket.EventMap>(
		type: K,
		listener: (event: Universal.WebSocket.EventMap[K]) => void,
	) {
		if (type === "message") {
			this.messageHandlers.add(
				listener as (event: Universal.WebSocket.MessageEvent) => void,
			);
		}
		if (type === "close") {
			this.closeHandlers.add(
				listener as (event: Universal.WebSocket.CloseEvent) => void,
			);
		}
	}

	removeEventListener<K extends keyof Universal.WebSocket.EventMap>(
		type: K,
		listener: (event: Universal.WebSocket.EventMap[K]) => void,
	) {
		if (type === "message") {
			this.messageHandlers.delete(
				listener as (event: Universal.WebSocket.MessageEvent) => void,
			);
		}
		if (type === "close") {
			this.closeHandlers.delete(
				listener as (event: Universal.WebSocket.CloseEvent) => void,
			);
		}
	}

	/** 注入一条前端 RPC 文本消息 */
	receive(text: string) {
		for (const handler of this.messageHandlers) {
			handler({ type: "message", data: text, target: this.socket });
		}
	}

	/** 触发连接关闭事件 */
	shutdown() {
		for (const handler of this.closeHandlers) {
			handler({ type: "close", code: 1000, reason: "", target: this.socket });
		}
	}

	get socket(): Universal.WebSocket {
		return this as unknown as Universal.WebSocket;
	}
}

/** 伪造的 WebSocket 升级请求（仅用到 headers / socket.remoteAddress） */
function fakeRequest(headers: Record<string, string> = {}) {
	return {
		headers,
		socket: { remoteAddress: "127.0.0.1" },
	} as unknown as IncomingMessage;
}

/** 读取某连接的全部出站消息 */
function readSent(socket: FakeSocket): SentMessage[] {
	return socket.sent.map((line) => JSON.parse(line) as SentMessage);
}

/** 等待一小段时间，让异步分发（RPC 回调 / 首屏同步）完成 */
function tick(ms = 20) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Console 抽象基类的最小实现：入口文件解析为固定前缀 URL */
class TestConsole extends Console {
	resolveEntry(files: Entry.Files, key: string): string[] {
		const list =
			typeof files === "string" || Array.isArray(files) ? files : files.prod;
		return makeArray(list).map((file) => `/assets/${key}/${file}`);
	}

	/** 接入一个内存客户端并返回其 Client 实例 */
	acceptClient(socket: Universal.WebSocket, request: IncomingMessage): Client {
		let accepted: Client | undefined;
		const dispose = this.ctx.on("console/connection", (client) => {
			accepted = client;
		});
		this.accept(socket, request);
		dispose();
		if (!accepted) throw new Error("client not accepted");
		return accepted;
	}
}

/** 测试用计数数据服务：get 每次返回自增后的值 */
class Counter extends DataService<number> {
	private value = 0;

	constructor(ctx: Context) {
		super(ctx, "counter" as never, {});
	}

	override async get() {
		return ++this.value;
	}
}

/** immediate 数据服务：启动时应自动推送一次 */
class ImmediateCounter extends DataService<number> {
	constructor(ctx: Context) {
		super(ctx, "immediate" as never, { immediate: true });
	}

	override async get() {
		return 42;
	}
}

/** 恒返回空值的数据服务：客户端首屏同步应跳过 */
class EmptyService extends DataService<number | null> {
	constructor(ctx: Context) {
		super(ctx, "empty" as never);
	}

	override async get() {
		return null;
	}
}

/** 无自定义 get 的数据服务：基类默认返回 null */
class BlockedService extends DataService<number> {
	constructor(ctx: Context) {
		super(ctx, "blocked" as never);
	}
}

const app = new App();
// Console 基类的 static inject 用的是 cordis 的 `{ optional: [...] }` 简写，
// 该简写在 cordis d.ts 的 Inject 类型里未表达（运行时受支持），
// 因此以纯构造器形状收窄后再交给 plugin()，避免 Inject 字典形状检查误报
type ConsoleHost = new (ctx: Context, config: undefined) => TestConsole;
app.plugin(TestConsole as ConsoleHost);
const service = app.console as TestConsole;

beforeAll(() => app.start());
afterAll(() => app.stop());

describe("@koishi-ce/console 基座", () => {
	describe("内置服务与 services 代理", () => {
		it("注册 entry / schema / permissions 三个内置数据服务", () => {
			expect(service.services.entry).toBeInstanceOf(EntryProvider);
			expect(service.services.schema).toBeInstanceOf(SchemaProvider);
			expect(service.services.permissions).toBeInstanceOf(PermissionProvider);
		});

		it("services 按名惰性解析，符号键直接透传", () => {
			const symbol = Symbol("probe");
			expect(
				(service.services as unknown as Record<symbol, unknown>)[symbol],
			).toBeUndefined();
			// 未注册的服务名解析为 undefined
			expect(
				(service.services as unknown as Record<string, unknown>)["nonexistent"],
			).toBeUndefined();
		});

		it("services 代理禁止写入", () => {
			expect(() => {
				(service.services as unknown as Record<string, unknown>)["entry"] = 1;
			}).toThrow();
		});

		it("内置 ping 监听器返回 pong", () => {
			// Listener.callback 的 this 形参类型为 Client，以最小桩满足调用形状
			const anyClient = { id: "ping-probe" } as Client;
			expect(service.listeners["ping"]?.callback.call(anyClient)).toBe("pong");
		});
	});

	describe("客户端接入与 RPC 分发", () => {
		it("accept 登记客户端并触发 connection 事件，close 时清理", async () => {
			const events: string[] = [];
			const dispose = app.on("console/connection", (client) => {
				events.push(client.id);
			});

			const socket = new FakeSocket();
			const client = service.acceptClient(socket.socket, fakeRequest());
			expect(service.clients[client.id]).toBe(client);
			expect(events).toEqual([client.id]);

			// 连接建立后触发首屏数据同步（entry 等内置服务立即下发）
			await tick();
			expect(
				readSent(socket).filter((msg) => msg.type === "data").length,
			).toBeGreaterThan(0);

			socket.shutdown();
			expect(service.clients[client.id]).toBeUndefined();
			expect(events).toEqual([client.id, client.id]);
			dispose();
		});

		it("未知事件回 not implemented，正常事件回传结果", async () => {
			// 未知事件的 console 域 info 是被测行为的预期伴生输出，静默之
			(Logger.levels as Record<string, number>)["console"] = 0;
			try {
				const socket = new FakeSocket();
				const client = service.acceptClient(socket.socket, fakeRequest());
				await tick();
				socket.sent.length = 0;

				let boundId = "";
				let boundArg: unknown;
				service.addListener("test/echo", function (this: Client, ...args) {
					boundId = this.id;
					boundArg = args[0];
					return args;
				});

				socket.receive(
					JSON.stringify({ type: "unknown-event", id: 1, args: [] }),
				);
				socket.receive(
					JSON.stringify({ type: "test/echo", id: 2, args: ["hello"] }),
				);
				await tick();

				expect(readSent(socket)[0]).toEqual({
					type: "response",
					body: { id: 1, error: "not implemented" },
				});
				expect(readSent(socket)[1]).toEqual({
					type: "response",
					body: { id: 2, value: ["hello"] },
				});
				// 回调的 this 绑定为发起调用的客户端
				expect(boundId).toBe(client.id);
				expect(boundArg).toBe("hello");
				socket.shutdown();
			} finally {
				delete (Logger.levels as Record<string, number>)["console"];
			}
		});

		it("回调抛错时回传 coerce 格式化的错误文本", async () => {
			const socket = new FakeSocket();
			service.acceptClient(socket.socket, fakeRequest());
			await tick();
			socket.sent.length = 0;

			service.addListener("test/boom", () => {
				throw new Error("boom");
			});
			socket.receive(JSON.stringify({ type: "test/boom", id: 3, args: [] }));
			await tick();

			const response = readSent(socket)[0];
			expect(response?.type).toBe("response");
			expect(response?.body.id).toBe(3);
			expect(String(response?.body.error)).toContain("boom");
			socket.shutdown();
		});

		it("console/intercept 拦截时回 unauthorized", async () => {
			const socket = new FakeSocket();
			service.acceptClient(socket.socket, fakeRequest());
			await tick();
			socket.sent.length = 0;

			let called = false;
			service.addListener(
				"test/secret",
				() => {
					called = true;
					return "s3cret";
				},
				{ authority: 5 },
			);
			const dispose = app.on("console/intercept", (_client, options) => {
				return options.authority === 5;
			});

			socket.receive(JSON.stringify({ type: "test/secret", id: 4, args: [] }));
			await tick();
			expect(readSent(socket)[0]).toEqual({
				type: "response",
				body: { id: 4, error: "unauthorized" },
			});
			expect(called).toBe(false);
			dispose();
			socket.shutdown();
		});
	});

	describe("广播", () => {
		it("向全部客户端广播静态与函数消息体", async () => {
			const socketA = new FakeSocket();
			const socketB = new FakeSocket();
			const clientA = service.acceptClient(socketA.socket, fakeRequest());
			const clientB = service.acceptClient(socketB.socket, fakeRequest());
			await tick();
			socketA.sent.length = 0;
			socketB.sent.length = 0;

			await service.broadcast("event", { static: true });
			await service.broadcast("event", (client: Client) => ({
				who: client.id,
			}));

			expect(socketA.sent).toHaveLength(2);
			expect(socketB.sent).toHaveLength(2);
			expect(readSent(socketA)[0]?.body).toEqual({ static: true });
			expect(readSent(socketA)[1]?.body).toEqual({ who: clientA.id });
			expect(readSent(socketB)[1]?.body).toEqual({ who: clientB.id });
			socketA.shutdown();
			socketB.shutdown();
		});

		it("被拦截器命中的客户端不参与广播；无客户端时为空操作", async () => {
			const socketA = new FakeSocket();
			const socketB = new FakeSocket();
			const clientA = service.acceptClient(socketA.socket, fakeRequest());
			service.acceptClient(socketB.socket, fakeRequest());
			await tick();
			socketA.sent.length = 0;
			socketB.sent.length = 0;

			const dispose = app.on("console/intercept", (client) => {
				return client === clientA;
			});
			await service.broadcast("blocked", null, { authority: 1 });
			expect(socketA.sent).toHaveLength(0);
			expect(socketB.sent).toHaveLength(1);
			dispose();

			// 两个连接都断开后广播应直接返回
			socketA.shutdown();
			socketB.shutdown();
			await expect(service.broadcast("nobody", 1)).resolves.toBeUndefined();
		});
	});

	describe("入口（Entry）", () => {
		it("addEntry 注册入口并随 get 下发（含 data 工厂与 loader 路径）", async () => {
			const socket = new FakeSocket();
			const client = service.acceptClient(socket.socket, fakeRequest());
			await tick();

			// 无 loader 时路径字段缺省
			const entry = service.addEntry(["a.js", "b.js"], () => ({ v: 1 }));
			const data = await service.get(client);
			const entryData = (data as Record<string, EntryItem | string>)[
				entry.id
			] as EntryItem | undefined;
			expect(entryData?.files).toEqual([
				`/assets/${entry.id}/a.js`,
				`/assets/${entry.id}/b.js`,
			]);
			expect(entryData?.paths).toBeUndefined();
			expect(entryData?.data).toEqual({ v: 1 });
			expect(typeof data._id).toBe("string");

			// 提供 loader 后路径随入口下发；注册入口即触发 entry 服务刷新
			app.provide("loader", {
				paths: () => ["group:entry", "plugins"],
			});
			const withPaths = await service.get(client);
			const withPathsEntry = (withPaths as Record<string, EntryItem | string>)[
				entry.id
			] as EntryItem | undefined;
			expect(withPathsEntry?.paths).toEqual(["group:entry", "plugins"]);
			await tick();
			expect(
				readSent(socket).filter(
					(msg) => msg.type === "data" && msg.body.key === "entry",
				).length,
			).toBeGreaterThan(0);

			entry.dispose();
			expect(service.entries[entry.id]).toBeUndefined();
			socket.shutdown();
		});

		it("Entry.refresh 广播 entry-data 消息", async () => {
			const socket = new FakeSocket();
			service.acceptClient(socket.socket, fakeRequest());
			await tick();

			const entry = service.addEntry("single.js", () => "payload");
			await tick();
			socket.sent.length = 0;
			// refresh 不返回广播 Promise，等待一拍让消息落地
			entry.refresh();
			await tick();
			expect(readSent(socket)[0]).toEqual({
				type: "entry-data",
				body: { id: entry.id, data: "payload" },
			});
			entry.dispose();
			socket.shutdown();
		});
	});

	describe("DataService", () => {
		it("refresh 广播全量数据，patch 广播增量补丁", async () => {
			const socket = new FakeSocket();
			service.acceptClient(socket.socket, fakeRequest());
			await tick();

			const fork = app.plugin(Counter);
			// 非 immediate 服务在 ready 后才 set 进容器，先等一拍再手动刷新
			await tick(30);
			await service.refresh("counter" as never);
			await service.patch("counter" as never, 100);
			await tick();

			const messages = readSent(socket).filter(
				(msg) => msg.body.key === "counter",
			);
			const dataValues = messages
				.filter((msg) => msg.type === "data")
				.map((msg) => msg.body.value);
			// 服务启动的自动刷新与手动 refresh 各推送一次，值单调递增
			expect(dataValues.length).toBeGreaterThanOrEqual(2);
			for (const value of dataValues) {
				expect(value).toBeGreaterThan(0);
			}
			expect(messages.find((msg) => msg.type === "patch")?.body.value).toBe(
				100,
			);
			fork.dispose();
			socket.shutdown();
		});

		it("immediate 服务在启动时自动推送首屏数据", async () => {
			const socket = new FakeSocket();
			service.acceptClient(socket.socket, fakeRequest());
			await tick();
			socket.sent.length = 0;

			const fork = app.plugin(ImmediateCounter);
			await tick(30);
			expect(
				readSent(socket).find(
					(msg) => msg.type === "data" && msg.body.key === "immediate",
				)?.body.value,
			).toBe(42);
			fork.dispose();
			socket.shutdown();
		});

		it("首屏同步跳过空值数据，被拦截服务下发 null", async () => {
			const emptyFork = app.plugin(EmptyService);
			const blockedFork = app.plugin(BlockedService);
			// 先等服务启动期的自动刷新落定（此时无客户端，广播为空操作）
			await tick(30);
			const socket = new FakeSocket();
			// 拦截 authority 门槛为 7 的服务
			const dispose = app.on("console/intercept", (_client, options) => {
				return options.authority === 7;
			});

			const client = service.acceptClient(socket.socket, fakeRequest());
			await tick();
			socket.sent.length = 0;
			client.refresh();
			await tick();
			// 两个服务 get 均返回 null：不产生任何首屏消息
			const messages = readSent(socket).filter((msg) => msg.type === "data");
			expect(messages.find((msg) => msg.body.key === "empty")).toBeUndefined();
			expect(
				messages.find((msg) => msg.body.key === "blocked"),
			).toBeUndefined();

			// 为 blocked 补上 authority 门槛后应下发 null
			const blocked = app.get("console.services.blocked") as DataService;
			blocked.options = { authority: 7 };
			socket.sent.length = 0;
			client.refresh();
			await tick();
			expect(
				readSent(socket).find(
					(msg) => msg.type === "data" && msg.body.key === "blocked",
				)?.body.value,
			).toBeNull();

			dispose();
			emptyFork.dispose();
			blockedFork.dispose();
			socket.shutdown();
		});
	});

	describe("内置数据服务的读取与事件刷新", () => {
		it("schema / permissions 服务返回核心服务数据", async () => {
			const schema = await service.services.schema.get();
			expect(schema).toBe(
				(app.schema as unknown as { _data: Dict<Schema> })._data,
			);
			const permissions = await service.services.permissions.get();
			expect(Array.isArray(permissions)).toBe(true);
		});

		it("internal/schema 与 internal/permission 事件触发服务刷新", async () => {
			const socket = new FakeSocket();
			service.acceptClient(socket.socket, fakeRequest());
			await tick();
			socket.sent.length = 0;

			// internal/schema 事件签名要求携带 schema 名，载荷本身不参与断言
			app.emit("internal/schema", "probe");
			app.emit("internal/permission");
			await tick();
			const keys = readSent(socket).map((msg) => msg.body.key);
			expect(keys).toContain("schema");
			expect(keys).toContain("permissions");
			socket.shutdown();
		});
	});

	describe("宿主上下文销毁", () => {
		it("应用停止时清理入口与服务", async () => {
			// 以独立 App 验证宿主销毁链路：入口先于服务注销，服务停止后不可再解析
			const localApp = new App();
			localApp.plugin(TestConsole as ConsoleHost);
			await localApp.start();
			const localConsole = localApp.console as TestConsole;
			const socket = new FakeSocket();
			localConsole.acceptClient(socket.socket, fakeRequest());
			await tick();
			expect(socket.sent.length).toBeGreaterThan(0);

			const entry = localConsole.addEntry("late.js");
			expect(localConsole.entries[entry.id]).toBeTruthy();
			// 入口先于服务注销（其销毁回调会回访 console 服务并异步触发 entry 刷新），
			// 等一拍让刷新广播落地后再停止应用，避免异步回访撞上服务卸载
			entry.dispose();
			await tick();
			await localApp.stop();
			expect(localApp.get("console")).toBeUndefined();
			socket.shutdown();
		});
	});
});
