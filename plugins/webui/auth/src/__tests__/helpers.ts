// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * @koishi-ce/plugin-auth（控制台鉴权）行为测试的公共装配与桩件。
 *
 * 以内存数据库 + TestConsole（内存 WebSocket 客户端）驱动真实 RPC 链路，
 * 供同目录 intercept / login / verification / user-events 四个主题测试文件
 * 复用，共同覆盖：管理员账户初始化、密码登录（含旧版 SHA-256 哈希透明升级）、
 * 令牌续期登录、平台验证码两步登录与绑定改挂、权限拦截、
 * 令牌删除 / 登出 / 资料更新 / 解绑等用户管理事件。
 */

import type { IncomingMessage } from "node:http";
import {
	type Client,
	Console,
	type Entry,
} from "@koishi-ce/console";
import {
	App,
	Logger,
	type Plugin,
	Time,
	type Universal,
} from "@koishi-ce/koishi";
import auth, { type Auth } from "@koishi-ce/plugin-auth";
import memory from "@koishi-ce/plugin-database-memory";
import mockClient from "@koishi-ce/plugin-mock";

/** 出站消息形状 */
interface SentMessage {
	type: string;
	body: {
		id?: number;
		key?: string;
		value?: unknown;
		error?: string;
	};
}

/** 内存 WebSocket 桩 */
class FakeSocket {
	sent: string[] = [];
	// message 与 close 的监听器统一为同构签名（never 载荷），保证集合存取类型一致
	private messageHandlers = new Set<
		(event: never) => void
	>();
	private closeHandlers = new Set<(event: never) => void>();

	send(data: string) {
		this.sent.push(data);
	}

	addEventListener(
		type: string,
		listener: (event: never) => void,
	) {
		if (type === "message")
			this.messageHandlers.add(listener);
		if (type === "close") this.closeHandlers.add(listener);
	}

	removeEventListener(
		type: string,
		listener: (event: never) => void,
	) {
		if (type === "message")
			this.messageHandlers.delete(listener);
		if (type === "close")
			this.closeHandlers.delete(listener);
	}

	receive(text: string) {
		for (const handler of this.messageHandlers) {
			handler({ data: Buffer.from(text) } as never);
		}
	}

	shutdown() {
		// close 监听器签名统一带 never 载荷，调用时补占位实参
		for (const handler of this.closeHandlers)
			handler(undefined as never);
	}

	get socket(): Universal.WebSocket {
		return this as unknown as Universal.WebSocket;
	}
}

function fakeRequest(headers: Record<string, string> = {}) {
	return {
		headers,
		socket: { remoteAddress: "127.0.0.1" },
	} as unknown as IncomingMessage;
}

export function tick(ms = 30) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Console 抽象基类的最小实现 */
class TestConsole extends Console {
	resolveEntry(files: Entry.Files, key: string): string[] {
		const list =
			typeof files === "string" || Array.isArray(files)
				? files
				: files.prod;
		return [String(list), key];
	}

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

/** 测试客户端：包一层真实 Client，提供 RPC 调用与消息读取 */
export class TestClient {
	readonly socket = new FakeSocket();
	readonly client: Client;
	private nextId = 0;

	constructor(
		service: TestConsole,
		headers: Record<string, string> = {},
	) {
		this.client = service.acceptClient(
			this.socket.socket,
			fakeRequest(headers),
		);
	}

	/** 发起一次 RPC 并轮询等待回执（PBKDF2 校验耗时较长，固定等待不可靠） */
	async call(
		type: string,
		args: unknown[],
		timeout = 5000,
	) {
		const id = ++this.nextId;
		this.socket.receive(JSON.stringify({ type, args, id }));
		const deadline = Date.now() + timeout;
		for (;;) {
			const response = this.messages().find(
				(msg) =>
					msg.type === "response" && msg.body.id === id,
			);
			if (response) return response.body;
			if (Date.now() > deadline) {
				throw new Error(`no response for ${type}`);
			}
			await tick(10);
		}
	}

	/** 最近一条 user 数据消息 */
	lastUserData() {
		const data = this.messages()
			.filter(
				(msg) =>
					msg.type === "data" && msg.body.key === "user",
			)
			.at(-1);
		return data?.body.value as
			| (Auth & { tokens: unknown[] })
			| null
			| undefined;
	}

	messages(): SentMessage[] {
		return this.socket.sent.map(
			(line) => JSON.parse(line) as SentMessage,
		);
	}

	close() {
		this.socket.shutdown();
	}
}

export type TestApp = InstanceType<typeof App>;

export let app: TestApp;
export let aliceId = 0;
export let bobId = 0;

export const service = () => app.console as TestConsole;

/**
 * 全量重建应用装配。裸跑（bun test 无 --isolate）时多测试文件共享本模块
 * 单例，stopApp 清理后由下一次 startApp 全量重建，避免对已停机实例二次
 * start。
 */
function rebuild() {
	app = new App();
	// 同 admin：CJS 实现配 ESM 声明，nodenext 互操作视图多包一层 default，类型层穿透取真实类
	app.plugin(memory);
	app.plugin(mockClient);
	// Console 基类的 static inject 是 cordis 3 旧形态，与 Plugin.Constructor 期待类型不兼容，仅做类型层转型
	app.plugin(
		TestConsole as unknown as Plugin.Constructor<App>,
	);
	app.plugin(auth, {
		admin: {
			enabled: true,
			username: "root",
			password: "admin-pass",
		},
		authTokenExpire: Time.week,
		loginTokenExpire: Time.minute * 5,
	});
}

/** 各主题测试文件的 beforeAll 钩子体：重建并启动宿主，预置 alice / bob 账户。 */
export async function startApp() {
	rebuild();
	// 「creating admin account」是启动期一次性生命周期 info，收敛为仅错误级
	(Logger.levels as Record<string, number>)["auth"] = 1;
	await app.start();
	// alice：用于平台验证码登录；bob：用于绑定改挂场景
	const alice = await app.database.createUser(
		"mock",
		"111",
		{
			name: "alice",
			authority: 2,
		},
	);
	const bob = await app.database.createUser("mock", "222", {
		name: "bob",
		authority: 1,
	});
	aliceId = alice.id;
	bobId = bob.id;
}

/** 各主题测试文件的 afterAll 钩子体：停机并恢复 auth 域日志阈值。 */
export async function stopApp() {
	// 先注销全部入口并等异步刷新落地，避免停机期间异步回访已卸载的 console 服务
	for (const entry of Object.values(service().entries)) {
		entry.dispose();
	}
	await tick();
	await app.stop();
	delete (Logger.levels as Record<string, number>)["auth"];
}

/** 以管理员身份登录并返回客户端 */
export async function loginAdmin() {
	const client = new TestClient(service(), {
		"user-agent": "test-agent",
		"x-forwarded-for": "1.2.3.4",
	});
	await client.call("login/password", [
		"root",
		"admin-pass",
	]);
	return client;
}
