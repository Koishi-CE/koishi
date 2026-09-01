// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 会话消息发送层（SessionMessaging）测试。
 *
 * 覆盖 send 的空内容跳过与失败容忍、sendQueued 排队发送的
 * 顺序与延迟估算（message / character 配置）、显式 delay，
 * 以及 cancelQueued 清空队列并延迟恢复的行为。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { App, type Session } from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";

const app = new App();
app.plugin(mock);
const bot = app.bots[0]!;

// 记录 sendMessage 调用内容的包装器
let contents: string[] = [];

function wrapSend(fail = false) {
	contents = [];
	// bot 实例可能被 cordis 的 traceable 代理包裹，直接赋值会触发
	// 其 set 陷阱，改用 defineProperty 在实例上覆盖
	Object.defineProperty(bot, "sendMessage", {
		value: async (_channelId: string, content: unknown) => {
			contents.push(String(content));
			if (fail) throw new Error("send failed");
			return ["id1"];
		},
		configurable: true,
	});
}

function restoreSend() {
	delete (bot as { sendMessage?: unknown }).sendMessage;
}

function createSession() {
	const session = bot.session({ channel: { id: "c1", type: 0 } });
	session.channelId = "c1";
	return session;
}

beforeAll(() => app.start());
afterAll(async () => {
	restoreSend();
	await app.stop();
});
afterEach(() => {
	restoreSend();
});

describe("Session Messaging", () => {
	it("send 空内容直接跳过", async () => {
		wrapSend();
		const session = createSession();
		await expect(session.send("")).resolves.toEqual([]);
		await expect(session.send([])).resolves.toEqual([]);
		expect(contents).toEqual([]);
	});

	it("send 发送失败只返回空数组不抛错", async () => {
		wrapSend(true);
		const session = createSession();
		await expect(session.send("hello")).resolves.toEqual([]);
		expect(contents).toEqual(["hello"]);
	});

	it("send 正常发送返回消息 ID 列表", async () => {
		wrapSend();
		const session = createSession();
		await expect(session.send("hello")).resolves.toEqual(["id1"]);
		expect(contents).toEqual(["hello"]);
	});

	it("sendQueued 按配置估算延迟并依次发送", async () => {
		wrapSend();
		// 每条消息基础延迟 5ms，无字符延迟
		app.koishi.config.delay!.message = 5;
		app.koishi.config.delay!.character = 0;
		const session = createSession();
		const first = session.sendQueued("a");
		const second = session.sendQueued("b");
		// 首条立即发出，第二条在 5ms 后发出，顺序保持
		await expect(first).resolves.toEqual(["id1"]);
		await expect(second).resolves.toEqual(["id1"]);
		expect(contents).toEqual(["a", "b"]);
		// 等待队列定时器清空
		await new Promise((resolve) => setTimeout(resolve, 10));
	});

	it("sendQueued 按字符数估算延迟", async () => {
		wrapSend();
		app.koishi.config.delay!.message = 0;
		// 每字符 1ms：长消息的等待明显长于短消息
		app.koishi.config.delay!.character = 1;
		const session = createSession();
		const start = Date.now();
		await session.sendQueued("short");
		const shortElapsed = Date.now() - start;
		const second = session.sendQueued("a-very-long-message");
		await second;
		const longElapsed = Date.now() - start;
		expect(shortElapsed).toBeLessThan(longElapsed);
		app.koishi.config.delay!.character = 0;
		await new Promise((resolve) => setTimeout(resolve, 30));
	});

	it("sendQueued 空内容不发送", async () => {
		wrapSend();
		const session = createSession();
		await expect(session.sendQueued("")).resolves.toBeUndefined();
		expect(contents).toEqual([]);
	});

	it("sendQueued 显式 delay 覆盖估算", async () => {
		wrapSend();
		app.koishi.config.delay!.message = 0;
		app.koishi.config.delay!.character = 0;
		const session = createSession();
		const start = Date.now();
		const first = session.sendQueued("a", 10);
		const second = session.sendQueued("b");
		await first;
		await second;
		// 第二条在首条发出 10ms 后才发出
		expect(Date.now() - start).toBeGreaterThanOrEqual(8);
		await new Promise((resolve) => setTimeout(resolve, 10));
	});

	it("cancelQueued 清空队列并在延迟后恢复", async () => {
		wrapSend();
		const session = createSession() as Session;
		// 首条立即发出，其后 20ms 内的第二条还在排队时取消；
		// 被取消任务的 promise 永不兑现，显式以 void 忽略
		const dropped = session.sendQueued("a", 20);
		void session.sendQueued("b");
		session.cancelQueued(5);
		await dropped;
		await new Promise((resolve) => setTimeout(resolve, 30));
		// "b" 被取消，不再发送；恢复后新的排队消息可以正常发出
		expect(contents).toEqual(["a"]);
		await session.sendQueued("c");
		expect(contents).toEqual(["a", "c"]);
		await new Promise((resolve) => setTimeout(resolve, 10));
	});
});
