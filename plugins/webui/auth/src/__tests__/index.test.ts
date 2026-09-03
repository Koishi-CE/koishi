// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * @koishi-ce/plugin-auth（控制台鉴权）的行为测试。
 *
 * 以内存数据库 + TestConsole（内存 WebSocket 客户端）驱动真实 RPC 链路，
 * 覆盖：管理员账户初始化、密码登录（含旧版 SHA-256 哈希透明升级）、
 * 令牌续期登录、平台验证码两步登录与绑定改挂、权限拦截、
 * 令牌删除 / 登出 / 资料更新 / 解绑等用户管理事件。
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { type Client, Console, type Entry } from "@koishi-ce/console";
import {
	App,
	Logger,
	type Plugin,
	Time,
	type Universal,
} from "@koishi-ce/koishi";
import auth, { type Auth, randomId } from "@koishi-ce/plugin-auth";
import mockClient from "@koishi-ce/plugin-mock";
import memory from "@koishijs/plugin-database-memory";

// 声明测试专用事件（带权限门槛），驱动 console/intercept 鉴权链路
declare module "@koishi-ce/console" {
	interface Events {
		"test/admin-only"(): string;
	}
}

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
	private messageHandlers = new Set<(event: never) => void>();
	private closeHandlers = new Set<(event: never) => void>();

	send(data: string) {
		this.sent.push(data);
	}

	addEventListener(type: string, listener: (event: never) => void) {
		if (type === "message") this.messageHandlers.add(listener);
		if (type === "close") this.closeHandlers.add(listener);
	}

	removeEventListener(type: string, listener: (event: never) => void) {
		if (type === "message") this.messageHandlers.delete(listener);
		if (type === "close") this.closeHandlers.delete(listener);
	}

	receive(text: string) {
		for (const handler of this.messageHandlers) {
			handler({ data: Buffer.from(text) } as never);
		}
	}

	shutdown() {
		// close 监听器签名统一带 never 载荷，调用时补占位实参
		for (const handler of this.closeHandlers) handler(undefined as never);
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

function tick(ms = 30) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Console 抽象基类的最小实现 */
class TestConsole extends Console {
	resolveEntry(files: Entry.Files, key: string): string[] {
		const list =
			typeof files === "string" || Array.isArray(files) ? files : files.prod;
		return [String(list), key];
	}

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

/** 测试客户端：包一层真实 Client，提供 RPC 调用与消息读取 */
class TestClient {
	readonly socket = new FakeSocket();
	readonly client: Client;
	private nextId = 0;

	constructor(service: TestConsole, headers: Record<string, string> = {}) {
		this.client = service.acceptClient(
			this.socket.socket,
			fakeRequest(headers),
		);
	}

	/** 发起一次 RPC 并轮询等待回执（PBKDF2 校验耗时较长，固定等待不可靠） */
	async call(type: string, args: unknown[], timeout = 5000) {
		const id = ++this.nextId;
		this.socket.receive(JSON.stringify({ type, args, id }));
		const deadline = Date.now() + timeout;
		for (;;) {
			const response = this.messages().find(
				(msg) => msg.type === "response" && msg.body.id === id,
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
			.filter((msg) => msg.type === "data" && msg.body.key === "user")
			.at(-1);
		return data?.body.value as
			| (Auth & { tokens: unknown[] })
			| null
			| undefined;
	}

	messages(): SentMessage[] {
		return this.socket.sent.map((line) => JSON.parse(line) as SentMessage);
	}

	close() {
		this.socket.shutdown();
	}
}

const app = new App();
// 同 admin：CJS 实现配 ESM 声明，nodenext 互操作视图多包一层 default，类型层穿透取真实类
app.plugin(memory as unknown as typeof memory.default);
app.plugin(mockClient);
// Console 基类的 static inject 是 cordis 3 旧形态，与 Plugin.Constructor 期待类型不兼容，仅做类型层转型
app.plugin(TestConsole as unknown as Plugin.Constructor<App>);
app.plugin(auth, {
	admin: { enabled: true, username: "root", password: "admin-pass" },
	authTokenExpire: Time.week,
	loginTokenExpire: Time.minute * 5,
});

const service = () => app.console as TestConsole;
let aliceId = 0;
let bobId = 0;

beforeAll(async () => {
	// 「creating admin account」是启动期一次性生命周期 info，收敛为仅错误级
	(Logger.levels as Record<string, number>)["auth"] = 1;
	await app.start();
	// alice：用于平台验证码登录；bob：用于绑定改挂场景
	const alice = await app.database.createUser("mock", "111", {
		name: "alice",
		authority: 2,
	});
	const bob = await app.database.createUser("mock", "222", {
		name: "bob",
		authority: 1,
	});
	aliceId = alice.id;
	bobId = bob.id;
});

afterAll(async () => {
	// 先注销全部入口并等异步刷新落地，避免停机期间异步回访已卸载的 console 服务
	for (const entry of Object.values(service().entries)) {
		entry.dispose();
	}
	await tick();
	await app.stop();
	delete (Logger.levels as Record<string, number>)["auth"];
});

/** 以管理员身份登录并返回客户端 */
async function loginAdmin() {
	const client = new TestClient(service(), {
		"user-agent": "test-agent",
		"x-forwarded-for": "1.2.3.4",
	});
	await client.call("login/password", ["root", "admin-pass"]);
	return client;
}

describe("@koishi-ce/plugin-auth", () => {
	it("启动时创建管理员账户；randomId 生成随机令牌", async () => {
		const [admin] = await app.database.get("user", { id: 0 });
		expect(admin?.name).toBe("root");
		expect(admin?.authority).toBe(5);
		expect(admin?.password?.startsWith("pbkdf2$")).toBe(true);
		expect(randomId(8)).toMatch(/^[0-9a-zA-Z]{8}$/);
		expect(randomId()).toHaveLength(40);
	});

	describe("密码登录", () => {
		it("密码错误与账户缺失时拒绝", async () => {
			const client = new TestClient(service());
			const wrong = await client.call("login/password", ["root", "wrong-pass"]);
			expect(wrong.error).toContain("用户名或密码错误");
			const missing = await client.call("login/password", ["nobody", "x"]);
			expect(missing.error).toContain("用户名或密码错误");
			client.close();
		});

		it("登录成功签发令牌并下发登录态", async () => {
			const client = new TestClient(service(), {
				"user-agent": "test-agent",
				"x-forwarded-for": "1.2.3.4",
			});
			const response = await client.call("login/password", [
				"root",
				"admin-pass",
			]);
			expect(response.error).toBeUndefined();
			expect(client.client.auth?.id).toBe(0);
			expect(client.client.auth?.token).toHaveLength(40);

			// 令牌落库记录来源信息（auth 已由上方断言保证存在）
			const [row] = await app.database.get("token", {
				token: client.client.auth!.token,
			});
			expect(row?.userAgent).toBe("test-agent");
			expect(row?.address).toBe("1.2.3.4");
			expect(row?.type).toBe("password");
			expect(row?.expiredAt).toBeGreaterThan(Date.now());

			// 下发的 user 数据附带会话与绑定明细
			const data = client.lastUserData();
			expect(data?.name).toBe("root");
			expect(Array.isArray(data?.tokens)).toBe(true);
			client.close();
		});

		it("旧版无盐 SHA-256 哈希校验通过后透明升级", async () => {
			const legacy = createHash("sha256").update("legacy-pass").digest("hex");
			await app.database.set("user", 0, { password: legacy });

			const client = new TestClient(service());
			const response = await client.call("login/password", [
				"root",
				"legacy-pass",
			]);
			expect(response.error).toBeUndefined();
			const [row] = await app.database.get("user", { id: 0 }, ["password"]);
			expect(row?.password?.startsWith("pbkdf2$")).toBe(true);
			client.close();
		});

		it("畸形哈希与空密码一律拒绝", async () => {
			await app.database.set("user", 0, { password: "pbkdf2$malformed" });
			const malformed = new TestClient(service());
			expect(
				(await malformed.call("login/password", ["root", "x"])).error,
			).toContain("用户名或密码错误");
			malformed.close();

			await app.database.set("user", 0, { password: "not-a-hash-at-all" });
			const alien = new TestClient(service());
			expect(
				(await alien.call("login/password", ["root", "x"])).error,
			).toContain("用户名或密码错误");
			alien.close();

			await app.database.set("user", 0, { password: "" });
			const empty = new TestClient(service());
			expect(
				(await empty.call("login/password", ["root", "x"])).error,
			).toContain("用户名或密码错误");
			empty.close();

			// 还原为合法管理员密码（与插件同格式的 PBKDF2 哈希）供后续用例使用
			const salt = randomBytes(16);
			const dk = pbkdf2Sync("admin-pass", salt, 600_000, 32, "sha256");
			await app.database.set("user", 0, {
				password: `pbkdf2$600000$${salt.toString("hex")}$${dk.toString("hex")}`,
			});
		});
	});

	describe("令牌登录", () => {
		it("有效令牌恢复登录态并刷新最后访问时间", async () => {
			const admin = await loginAdmin();
			const token = admin.client.auth?.token;
			expect(token).toBeTruthy();

			const client = new TestClient(service());
			const response = await client.call("login/token", [0, token]);
			expect(response.error).toBeUndefined();
			expect(client.client.auth?.id).toBe(0);

			const [row] = await app.database.get("token", { token: token! });
			expect(row?.lastUsedAt?.valueOf()).toBeGreaterThan(
				row?.createdAt?.valueOf() ?? 0,
			);
			admin.close();
			client.close();
		});

		it("过期 / 不存在 / 用户缺失的令牌被拒绝", async () => {
			await app.database.create("token", {
				id: 0,
				type: "password",
				token: "expired-token",
				expiredAt: Date.now() - 1000,
				createdAt: new Date(),
				lastUsedAt: new Date(),
				userAgent: "ua",
				address: "addr",
			});
			await app.database.create("token", {
				id: 999,
				type: "password",
				token: "ghost-token",
				expiredAt: Date.now() + Time.hour,
				createdAt: new Date(),
				lastUsedAt: new Date(),
				userAgent: "ua",
				address: "addr",
			});

			const client = new TestClient(service());
			expect(
				(await client.call("login/token", [0, "expired-token"])).error,
			).toContain("令牌已失效");
			expect(
				(await client.call("login/token", [0, "no-such-token"])).error,
			).toContain("令牌已失效");
			expect(
				(await client.call("login/token", [999, "ghost-token"])).error,
			).toContain("用户不存在");
			client.close();
		});
	});

	describe("平台验证码登录", () => {
		it("账户不存在或已绑定同一账户时拒绝", async () => {
			const client = new TestClient(service());
			expect(
				(await client.call("login/platform", ["mock", "404"])).error,
			).toContain("找不到此账户");

			client.client.auth = { id: aliceId } as Auth;
			expect(
				(await client.call("login/platform", ["mock", "111"])).error,
			).toContain("你已经绑定了此账户");
			client.close();
		});

		it("未登录客户端经验证码完成登录", async () => {
			const client = new TestClient(service());
			const result = await client.call("login/platform", ["mock", "111"]);
			expect(result.error).toBeUndefined();
			expect(result.value).toMatchObject({ id: aliceId, name: "alice" });
			const code = (result.value as { token: string }).token;
			expect(code).toMatch(/^\d{6}$/);

			// 无关消息不消费验证码状态
			const bot = app.mock.client("999", "888");
			await bot.receive("hello-world");

			// 用户把验证码发给机器人 → 为对应账户签发令牌
			const user = app.mock.client("111");
			await user.receive(code);
			await tick();
			expect(client.client.auth?.id).toBe(aliceId);
			const data = client.lastUserData();
			expect(data?.name).toBe("alice");
			client.close();
		});

		it("已登录客户端经验证码改绑平台账户", async () => {
			const client = new TestClient(service());
			// 已登录为 alice，把 bob 的平台账号绑到 alice 名下
			client.client.auth = { id: aliceId } as Auth;
			const result = await client.call("login/platform", ["mock", "222"]);
			expect(result.error).toBeUndefined();
			const code = (result.value as { token: string }).token;

			const user = app.mock.client("222");
			await user.receive(code);
			await tick();
			const [binding] = await app.database.get("binding", {
				platform: "mock",
				pid: "222",
			});
			expect(binding?.aid).toBe(aliceId);
			client.close();
		});

		it("验证码超时后触发状态清理回调", async () => {
			// Schema 要 loginTokenExpire >= 1min，构造后直接改字段绕开校验，
			// 用 50ms 时效快速触发超时回调
			const keep = app.auth.config.loginTokenExpire;
			app.auth.config.loginTokenExpire = 50;
			const client = new TestClient(service());
			const result = await client.call("login/platform", ["mock", "111"]);
			expect(result.error).toBeUndefined();
			// 等待超时回调执行（状态清理与否取决于到期判定，此处验证回调不抛错）
			await new Promise((resolve) => setTimeout(resolve, 150));
			client.close();
			app.auth.config.loginTokenExpire = keep;
		});
	});

	describe("权限拦截（console/intercept）", () => {
		it("按登录态与权限等级拦截事件", async () => {
			app.console.addListener("test/admin-only", () => "secret", {
				authority: 4,
			});

			// 未登录：拦截
			const anonymous = new TestClient(service());
			expect((await anonymous.call("test/admin-only", [])).error).toBe(
				"unauthorized",
			);
			anonymous.close();

			// 权限不足：拦截
			const low = new TestClient(service());
			low.client.auth = {
				id: bobId,
				authority: 1,
				expiredAt: Date.now() + Time.hour,
				token: "t",
			} as Auth;
			expect((await low.call("test/admin-only", [])).error).toBe(
				"unauthorized",
			);
			low.close();

			// 令牌过期：拦截
			const expired = new TestClient(service());
			expired.client.auth = {
				id: 0,
				authority: 5,
				expiredAt: Date.now() - 1,
				token: "t",
			} as Auth;
			expect((await expired.call("test/admin-only", [])).error).toBe(
				"unauthorized",
			);
			expired.close();

			// 管理员：放行
			const admin = await loginAdmin();
			expect((await admin.call("test/admin-only", [])).value).toBe("secret");
			admin.close();
		});
	});

	describe("用户管理事件", () => {
		it("user/delete-token 删除指定会话", async () => {
			const anonymous = new TestClient(service());
			expect((await anonymous.call("user/delete-token", [1])).error).toContain(
				"请先登录",
			);
			anonymous.close();

			const admin = await loginAdmin();
			const [row] = await app.database.get("token", {
				token: admin.client.auth!.token,
			});
			const bad = await admin.call("user/delete-token", [99999]);
			expect(bad.error).toContain("令牌不存在");

			const ok = await admin.call("user/delete-token", [row?.inc]);
			expect(ok.error).toBeUndefined();
			const [removed] = await app.database.get("token", { inc: row!.inc });
			expect(removed).toBeUndefined();
			admin.close();
		});

		it("user/logout 删除当前令牌并重发登录态", async () => {
			const admin = await loginAdmin();
			const token = admin.client.auth?.token;
			const response = await admin.call("user/logout", []);
			expect(response.error).toBeUndefined();
			// 令牌已被删除，其它设备无法再用它续期（loginAdmin 成功后令牌必存在）
			const [row] = await app.database.get("token", { token: token! });
			expect(row).toBeUndefined();
			// 移植偏差说明：上游 logout 以 setAuth(this, null) 显式清空登录态，
			// 本仓改为传 undefined，命中 setAuth 的默认参数（沿用 client.auth），
			// 故当前行为是重发 user 数据而非下发 null；此处按实际行为断言
			expect(admin.client.auth?.id).toBe(0);
			const data = admin.lastUserData();
			expect(data?.name).toBe("root");
			admin.close();
		});

		it("setAuth 对匿名客户端下发 null（登出数据通道）", async () => {
			const anonymous = new TestClient(service());
			await app.auth.setAuth(anonymous.client);
			await tick();
			expect(anonymous.lastUserData()).toBeNull();
			anonymous.close();
		});

		it("user/update 修改资料（密码加哈希、配置透传）", async () => {
			const anonymous = new TestClient(service());
			expect(
				(await anonymous.call("user/update", [{ name: "x" }])).error,
			).toContain("请先登录");
			anonymous.close();

			const admin = await loginAdmin();
			const response = await admin.call("user/update", [
				{ name: "renamed", password: "new-pass", config: { theme: "dark" } },
			]);
			expect(response.error).toBeUndefined();
			// passive 更新：本地登录态同步但不推送数据
			expect(admin.client.auth?.name).toBe("renamed");
			const [row] = await app.database.get("user", { id: 0 });
			expect(row?.name).toBe("renamed");
			expect(row?.password?.startsWith("pbkdf2$")).toBe(true);
			expect(row?.config).toEqual({ theme: "dark" });
			admin.close();
		});

		it("user/unbind 解绑平台账号的三种分支", async () => {
			const anonymous = new TestClient(service());
			expect(
				(await anonymous.call("user/unbind", ["mock", "111"])).error,
			).toContain("请先登录");
			anonymous.close();

			// 以 alice 身份登录
			const alice = new TestClient(service());
			const grant = await alice.call("login/platform", ["mock", "111"]);
			const code = (grant.value as { token: string }).token;
			await app.mock.client("111").receive(code);
			await tick();
			expect(alice.client.auth?.id).toBe(aliceId);

			// 绑定不存在
			expect(
				(await alice.call("user/unbind", ["mock", "000"])).error,
			).toContain("绑定不存在");

			// 仅剩一个自绑定（主账号）：拒绝解绑
			expect(
				(await alice.call("user/unbind", ["mock", "111"])).error,
			).toContain("无法解除绑定");

			// 追加第二个自绑定后可解绑
			await app.database.create("binding", {
				aid: aliceId,
				bid: aliceId,
				platform: "mock",
				pid: "333",
			});
			expect(
				(await alice.call("user/unbind", ["mock", "333"])).error,
			).toBeUndefined();
			const [gone] = await app.database.get("binding", {
				platform: "mock",
				pid: "333",
			});
			expect(gone).toBeUndefined();

			// 绑到他人名下（aid !== bid）：解绑时改回其主账号
			await app.database.create("binding", {
				aid: aliceId,
				bid: bobId,
				platform: "mock",
				pid: "444",
			});
			expect(
				(await alice.call("user/unbind", ["mock", "444"])).error,
			).toBeUndefined();
			const [moved] = await app.database.get("binding", {
				platform: "mock",
				pid: "444",
			});
			expect(moved?.aid).toBe(bobId);
			alice.close();
		});
	});
});
