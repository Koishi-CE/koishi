// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * @koishi-ce/console 服务端基座行为测试的公共装配与桩件。
 *
 * 以 TestConsole（Console 抽象基类的最小实现）+ FakeSocket（内存 WebSocket）
 * 驱动，供同目录 rpc / data-service / services 三个主题测试文件复用，
 * 共同覆盖：内置三数据服务的注册与读取、services 代理、客户端接入/断开、
 * RPC 分发（含鉴权拦截与错误回传）、广播、入口（Entry）生命周期、
 * DataService 的 refresh / patch 与 immediate 启动推送、宿主销毁时的清理。
 */

import type { IncomingMessage } from "node:http";
import {
	type Client,
	Console,
	DataService,
	type Entry,
} from "@koishi-ce/console";
import {
	App,
	type Context,
	makeArray,
	type Universal,
} from "@koishi-ce/koishi";

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
export interface EntryItem {
	files: string[];
	paths?: string[];
	data: unknown;
}

/** 内存 WebSocket 桩：记录出站消息，可注入入站消息与 close 事件 */
export class FakeSocket {
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

	addEventListener<
		K extends keyof Universal.WebSocket.EventMap,
	>(
		type: K,
		listener: (
			event: Universal.WebSocket.EventMap[K],
		) => void,
	) {
		if (type === "message") {
			this.messageHandlers.add(
				listener as (
					event: Universal.WebSocket.MessageEvent,
				) => void,
			);
		}
		if (type === "close") {
			this.closeHandlers.add(
				listener as (
					event: Universal.WebSocket.CloseEvent,
				) => void,
			);
		}
	}

	removeEventListener<
		K extends keyof Universal.WebSocket.EventMap,
	>(
		type: K,
		listener: (
			event: Universal.WebSocket.EventMap[K],
		) => void,
	) {
		if (type === "message") {
			this.messageHandlers.delete(
				listener as (
					event: Universal.WebSocket.MessageEvent,
				) => void,
			);
		}
		if (type === "close") {
			this.closeHandlers.delete(
				listener as (
					event: Universal.WebSocket.CloseEvent,
				) => void,
			);
		}
	}

	/** 注入一条前端 RPC 文本消息 */
	receive(text: string) {
		for (const handler of this.messageHandlers) {
			handler({
				type: "message",
				data: text,
				target: this.socket,
			});
		}
	}

	/** 触发连接关闭事件 */
	shutdown() {
		for (const handler of this.closeHandlers) {
			handler({
				type: "close",
				code: 1000,
				reason: "",
				target: this.socket,
			});
		}
	}

	get socket(): Universal.WebSocket {
		return this as unknown as Universal.WebSocket;
	}
}

/** 伪造的 WebSocket 升级请求（仅用到 headers / socket.remoteAddress） */
export function fakeRequest(
	headers: Record<string, string> = {},
) {
	return {
		headers,
		socket: { remoteAddress: "127.0.0.1" },
	} as unknown as IncomingMessage;
}

/** 读取某连接的全部出站消息 */
export function readSent(
	socket: FakeSocket,
): SentMessage[] {
	return socket.sent.map(
		(line) => JSON.parse(line) as SentMessage,
	);
}

/** 等待一小段时间，让异步分发（RPC 回调 / 首屏同步）完成 */
export function tick(ms = 20) {
	return Bun.sleep(ms);
}

/** Console 抽象基类的最小实现：入口文件解析为固定前缀 URL */
export class TestConsole extends Console {
	resolveEntry(files: Entry.Files, key: string): string[] {
		const list =
			typeof files === "string" || Array.isArray(files)
				? files
				: files.prod;
		return makeArray(list).map(
			(file) => `/assets/${key}/${file}`,
		);
	}

	/** 接入一个内存客户端并返回其 Client 实例 */
	acceptClient(
		socket: Universal.WebSocket,
		request: IncomingMessage,
	): Client {
		let accepted: Client | undefined;
		const dispose = this.ctx.on(
			"console/connection",
			(client) => {
				accepted = client;
			},
		);
		this.accept(socket, request);
		dispose();
		if (!accepted) throw new Error("client not accepted");
		return accepted;
	}
}

/** 测试用计数数据服务：get 每次返回自增后的值 */
export class Counter extends DataService<number> {
	private value = 0;

	constructor(ctx: Context) {
		super(ctx, "counter" as never, {});
	}

	override async get() {
		return ++this.value;
	}
}

/** immediate 数据服务：启动时应自动推送一次 */
export class ImmediateCounter extends DataService<number> {
	constructor(ctx: Context) {
		super(ctx, "immediate" as never, { immediate: true });
	}

	override async get() {
		return 42;
	}
}

/** 恒返回空值的数据服务：客户端首屏同步应跳过 */
export class EmptyService extends DataService<
	number | null
> {
	constructor(ctx: Context) {
		super(ctx, "empty" as never);
	}

	override async get() {
		return null;
	}
}

/** 无自定义 get 的数据服务：基类默认返回 null */
export class BlockedService extends DataService<number> {
	constructor(ctx: Context) {
		super(ctx, "blocked" as never);
	}
}

export let app: App;
export let service: TestConsole;

// Console 基类的 static inject 用的是 cordis 的 `{ optional: [...] }` 简写，
// 该简写在 cordis d.ts 的 Inject 类型里未表达（运行时受支持），
// 因此以纯构造器形状收窄后再交给 plugin()，避免 Inject 字典形状检查误报
export type ConsoleHost = new (
	ctx: Context,
	config: undefined,
) => TestConsole;

/**
 * 全量重建应用装配。裸跑（bun test 无 --isolate）时多测试文件共享本模块
 * 单例，stopApp 清理后由下一次 startApp 全量重建，避免对已停机实例二次
 * start。
 */
function rebuild() {
	app = new App();
	app.plugin(TestConsole as ConsoleHost);
	service = app.console as TestConsole;
}

/** 各主题测试文件的 beforeAll 钩子体：重建并启动宿主。 */
export async function startApp() {
	rebuild();
	await app.start();
}

/**
 * 各主题测试文件的 afterAll 钩子体：停机。先冲刷一拍悬挂的异步广播
 * （DataService.refresh 不等待 broadcast 完成、Entry.dispose 会异步触发
 * entry 刷新），避免停机窗口内异步回访撞上已卸载的服务。
 */
export async function stopApp() {
	await tick();
	await app.stop();
}
