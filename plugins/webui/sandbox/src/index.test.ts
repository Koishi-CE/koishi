// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Client, Console, type Entry } from "@koishi-ce/console";
import { App, type Plugin } from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";
import server from "@koishi-ce/plugin-server";
import memory from "@koishijs/plugin-database-memory";
import { SandboxBot } from "./bot.ts";
import type { Config } from "./index.ts";
import * as sandbox from "./index.ts";
import { SandboxMessenger } from "./message.ts";

/** 控制台服务桩：仅实现入口登记所需的最小面。 */
class FakeConsole extends Console {
	protected resolveEntry(_files: Entry.Files, _key: string): string[] {
		return [];
	}
}

/** 记录下发消息的假浏览器连接（充当 RPC 监听器的 this）。 */
function createFakeClient() {
	const sent: { type: string; body?: unknown }[] = [];
	return {
		client: {
			sent,
			send(payload: { type: string; body?: unknown }) {
				sent.push(payload);
			},
		} as unknown as Client,
		sent,
	};
}

/** 探测一个空闲端口（server 插件在 port 为 0 时不监听，需给定真实端口）。 */
function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const net = require("node:net") as typeof import("node:net");
		const probe = net.createServer();
		probe.listen(0, "127.0.0.1", () => {
			const address = probe.address();
			const port = typeof address === "object" && address ? address.port : 0;
			probe.close(() => resolve(port));
		});
		probe.on("error", reject);
	});
}

const serverPort = await getFreePort();

const app = new App();

// 同 admin：CJS 实现配 ESM 声明，nodenext 互操作视图多包一层 default，类型层穿透取真实类
app.plugin(memory as unknown as typeof memory.default);
app.plugin(server, { host: "127.0.0.1", port: serverPort });
// Console 基类的 static inject 是 cordis 3 旧形态，与 Plugin.Constructor 期待类型不兼容，仅做类型层转型
app.plugin(FakeConsole as unknown as Plugin.Constructor<App>);
app.plugin(sandbox, { fileServer: { enabled: true } } as Config);
app.plugin(mock);

/** 以假客户端身份调用指定 RPC 监听器。 */
async function call<K extends keyof Console["listeners"]>(
	event: K,
	client: Client,
	...args: unknown[]
) {
	const listener = app.console.listeners[event];
	if (!listener) throw new Error(`listener ${event} not found`);
	return listener.callback.call(client, ...(args as never[]));
}

beforeAll(() => app.start());

afterAll(async () => {
	await app.stop();
});

describe("sandbox 插件", () => {
	it("加载数据服务与浏览器侧 RPC 监听器", () => {
		expect(app.get("console.services.sandbox")).toBeDefined();
		for (const event of [
			"sandbox/send-message",
			"sandbox/delete-message",
			"sandbox/get-user",
			"sandbox/set-user",
			"sandbox/response",
		]) {
			expect(app.console.listeners[event]).toBeDefined();
		}
	});

	it("send-message 回显消息并派发沙盒会话", async () => {
		const { client, sent } = createFakeClient();
		await call(
			"sandbox/send-message",
			client,
			"sandbox:web",
			"123",
			"#main",
			"你好",
		);
		// 浏览器侧先收到回显的消息体
		expect(sent[0]?.type).toBe("sandbox/message");
		expect(sent[0]?.body).toMatchObject({
			user: "123",
			channel: "#main",
			platform: "sandbox:web",
			content: "你好",
		});
		// 沙盒 bot 已按平台登记且隐藏
		const bot = app.bots["sandbox:web:koishi"] as SandboxBot | undefined;
		expect(bot).toBeDefined();
		expect(bot?.hidden).toBe(true);
		expect(bot?.platform).toBe("sandbox:web");
	});

	it("clear 指令通知浏览器清空消息", async () => {
		const { client, sent } = createFakeClient();
		await call(
			"sandbox/send-message",
			client,
			"sandbox:clear",
			"123",
			"#main",
			"clear",
		);
		// 会话经 dispatch 异步走中间件，等待处理完成
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(sent.some((message) => message.type === "sandbox/clear")).toBe(true);
	});

	it("delete-message 派发消息删除事件", async () => {
		const { client } = createFakeClient();
		await expect(
			call(
				"sandbox/delete-message",
				client,
				"sandbox:web",
				"123",
				"#main",
				"msg-1",
			),
		).resolves.toBeUndefined();
	});

	it("get-user 无绑定时按 authority 1 现场创建", async () => {
		const { client } = createFakeClient();
		const user = (await call(
			"sandbox/get-user",
			client,
			"sandbox:web",
			"123",
		)) as { authority: number };
		expect(user.authority).toBe(1);
		// 再次查询返回同一绑定用户
		const again = (await call(
			"sandbox/get-user",
			client,
			"sandbox:web",
			"123",
		)) as { authority: number };
		expect(again).toBeTruthy();
	});

	it("set-user 触发成员事件并按数据更新 / 删除用户", async () => {
		const { client } = createFakeClient();
		// data 非空：guild-member-added + 更新用户字段
		await call("sandbox/set-user", client, "sandbox:web", "123", {
			authority: 2,
		});
		const user = await app.database.getUser("sandbox:web", "123");
		expect(user?.authority).toBe(2);

		// data 为 null：guild-member-removed + 删除绑定与用户
		await call("sandbox/set-user", client, "sandbox:web", "123", null);
		const removed = await app.database.getUser("sandbox:web", "123");
		expect(removed).toBeUndefined();

		// 无绑定且 data 为 null：直接返回不创建
		await call("sandbox/set-user", client, "sandbox:web", "404", null);
		const none = await app.database.getUser("sandbox:web", "404");
		expect(none).toBeUndefined();
	});

	it("response 监听器把浏览器应答转发为应用事件", async () => {
		const { client } = createFakeClient();
		let received: unknown;
		const dispose = app.on("sandbox/response", (nonce, data) => {
			received = [nonce, data];
		});
		await call("sandbox/response", client, "nonce-1", { ok: true });
		dispose();
		expect(received).toEqual(["nonce-1", { ok: true }]);
	});

	it("SandboxBot.request 以 nonce 关联应答", async () => {
		const { client, sent } = createFakeClient();
		const bot = new SandboxBot(app, client, {
			platform: "sandbox:probe",
			selfId: "koishi",
		});
		const task = bot.request<{ size: number }>("getChannelList", {
			guildId: "g",
		});
		const request = sent[0];
		expect(request?.type).toBe("sandbox/request");
		const nonce = (request as { body: { nonce: string } }).body.nonce;
		app.emit("sandbox/response", nonce, { size: 3 });
		await expect(task).resolves.toEqual({ size: 3 });
	});

	it("SandboxBot 的主动 API 封装 request", async () => {
		const { client, sent } = createFakeClient();
		const bot = new SandboxBot(app, client, {
			platform: "sandbox:api",
			selfId: "koishi",
		});
		const task = bot.deleteMessage("c1", "m1");
		const request = sent.find((message) => message.type === "sandbox/request");
		expect(request?.body).toMatchObject({
			method: "deleteMessage",
			data: { channelId: "c1", messageId: "m1" },
		});
		const nonce = (request as { body: { nonce: string } }).body.nonce;
		app.emit("sandbox/response", nonce, undefined);
		await expect(task).resolves.toBeUndefined();
		// 私聊频道 id 约定为 @userId
		await expect(bot.createDirectChannel("u1")).resolves.toEqual({
			id: "@u1",
			type: 1,
		});
	});

	it("SandboxBot 其余主动 API 同样经 request 转发", async () => {
		const { client, sent } = createFakeClient();
		const bot = new SandboxBot(app, client, {
			platform: "sandbox:api2",
			selfId: "koishi",
		});
		// 发起全部封装调用后统一应答
		const tasks = [
			bot.getMessage("c", "m"),
			bot.getChannel("c"),
			bot.getChannelList("g"),
			bot.getGuild("g"),
			bot.getGuildList(),
			bot.getGuildMember("g", "u"),
			bot.getGuildMemberList("g"),
		];
		const methods = sent
			.filter((message) => message.type === "sandbox/request")
			.map(
				(message) => (message.body as { method: string; nonce: string }).method,
			);
		expect(methods).toEqual([
			"getMessage",
			"getChannel",
			"getChannelList",
			"getGuild",
			"getGuildList",
			"getGuildMember",
			"getGuildMemberList",
		]);
		for (const message of sent) {
			if (message.type !== "sandbox/request") continue;
			// sandbox/response 为本插件自定义协议事件（载荷 { data } 对象），
			// 与 satori 通用事件名的声明载荷不同，仅做类型层断言
			app.emit("sandbox/response", (message.body as { nonce: string }).nonce, {
				data: true,
			} as never);
		}
		const results = await Promise.all(tasks);
		for (const result of results) {
			// request 的返回类型是 satori 通用实体联合，实际载荷为自定义 { data } 对象，期望值做类型层断言
			expect(result).toEqual({ data: true } as never);
		}
	});

	it("SandboxBot.request 超时后拒绝", async () => {
		const { client } = createFakeClient();
		const bot = new SandboxBot(app, client, {
			platform: "sandbox:timeout",
			selfId: "koishi",
		});
		await expect(bot.request("never")).rejects.toThrow("timeout");
	}, 8000);

	it("SandboxMessenger 按分段 flush 并推回浏览器", async () => {
		const { client, sent } = createFakeClient();
		const bot = new SandboxBot(app, client, {
			platform: "sandbox:msg",
			selfId: "koishi",
		});
		const session = bot.session({
			channel: { id: "#main", type: 0 },
			user: { id: "koishi", name: "koishi" },
		});
		const encoder = new SandboxMessenger(bot, "#main", undefined, {
			session,
		});
		// send() 会以 options.session 为模板创建发送会话并渲染分段
		await encoder.send("第一段<message>第二段</message>第三段");
		const messages = sent.filter((m) => m.type === "sandbox/message");
		expect(messages.length).toBe(3);
		expect(messages[0]?.body).toMatchObject({
			content: "第一段",
			user: "Koishi",
		});
		expect(messages[1]?.body).toMatchObject({ content: "第二段" });
		expect(messages[2]?.body).toMatchObject({ content: "第三段" });
	});

	it("SandboxMessenger 把 file: 媒体重写到沙盒文件服务", async () => {
		const { client, sent } = createFakeClient();
		const bot = new SandboxBot(app, client, {
			platform: "sandbox:media",
			selfId: "koishi",
		});
		const session = bot.session({
			channel: { id: "#main", type: 0 },
			user: { id: "koishi", name: "koishi" },
		});
		const encoder = new SandboxMessenger(bot, "#main", undefined, {
			session,
		});
		await encoder.send('<img src="file:///C:/pic.png"/>');
		const message = sent.find((m) => m.type === "sandbox/message");
		const content = (message as { body: { content: string } }).body.content;
		expect(content).toContain(
			`http://127.0.0.1:${serverPort}/sandbox/file:///C:/pic.png`,
		);
		// 非 file: 协议的媒体原样透传
		sent.length = 0;
		await encoder.send('<img src="https://example.com/pic.png"/>');
		const direct = sent.find((m) => m.type === "sandbox/message");
		expect((direct as { body: { content: string } }).body.content).toContain(
			"https://example.com/pic.png",
		);
	});

	it("数据服务按平台统计绑定用户数", async () => {
		await app.database.createUser("sandbox:stats", "u1", { authority: 1 });
		const svc = app.get("console.services.sandbox");
		const data = (await svc?.get()) as Record<string, number>;
		expect(data["sandbox:stats"]).toBe(1);
	});

	it("新连接接入时清理已失联平台的沙盒 bot", async () => {
		const { client } = createFakeClient();
		await call(
			"sandbox/send-message",
			client,
			"sandbox:cleanup",
			"1",
			"#c",
			"hi",
		);
		expect(app.bots["sandbox:cleanup:koishi"]).toBeDefined();
		// 同一 client 的连接接入事件（不在 clients 表中）触发清理
		app.emit("console/connection", client);
		expect(app.bots["sandbox:cleanup:koishi"]).toBeUndefined();
	});

	it("fileServer 提供本地 file: 资源的 HTTP 访问", async () => {
		const tmp = mkdtempSync(join(tmpdir(), "sandbox-fs-"));
		writeFileSync(join(tmp, "asset.txt"), "asset-bytes");
		try {
			// koa-router 的参数捕获在解码前进行，file: 路径需以未编码形态进入 path
			const response = await fetch(
				`http://127.0.0.1:${serverPort}/sandbox/${`file:///${join(tmp, "asset.txt").replaceAll("\\", "/")}`}`,
			);
			expect(response.status).toBe(200);
			expect(await response.text()).toBe("asset-bytes");
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});
