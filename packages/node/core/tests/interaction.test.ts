// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 平台斜线指令（interaction/command）接入与命令执行的边界测试。
 *
 * 覆盖 setupCommander 注册的 interaction/command 监听的两种接入路径
 * （结构化 argv 直接执行 / 伪装称呼消息走常规解析）、
 * before-parse 短路导致解析失败的告警分支，
 * 以及 session.execute 对未知命令名的警告路径。
 */
import { afterAll, beforeAll, describe, expect, it, jest } from "bun:test";
import { App, Logger, type Session } from "@koishi-ce/koishi";
import mock, { type MockBot } from "@koishi-ce/plugin-mock";

const app = new App();
app.plugin(mock);
// receive 是 MockBot 上的模拟派发方法，从通用 Bot 形状收窄回 MockBot
const bot = app.bots[0] as MockBot;

let captured: string | null = null;
app.command("slashy <arg>").action((_argv, arg) => {
	captured = arg ?? null;
	return "done";
});

// 捕获 command / session 通道的警告输出
const print = jest.fn();

beforeAll(() => {
	Logger.levels.base = 1;
	Logger.targets.push({ levels: { base: 0, command: 3, session: 3 }, print });
	return app.start();
});

afterAll(async () => {
	Logger.levels.base = 2;
	Logger.targets.pop();
	await app.stop();
});

function createSession(content?: string) {
	const session = bot.session({
		type: "interaction/command",
		platform: "mock",
		selfId: bot.selfId,
		channel: { id: "c1", type: 0 },
		user: { id: "u1", name: "u1" },
	}) as Session;
	if (content !== undefined) session.content = content;
	return session;
}

describe("Interaction Command", () => {
	it("平台已给出结构化 argv 时直接按名执行", async () => {
		captured = null;
		bot.receive({
			type: "interaction/command",
			platform: "mock",
			selfId: bot.selfId,
			channel: { id: "c1", type: 0 },
			user: { id: "u1", name: "u1" },
			argv: { name: "slashy", arguments: ["hello"], options: {} },
		} as never);
		await new Promise((resolve) => setTimeout(resolve, 10));
		// captured 会在异步回调中被赋值，按声明类型比较避免被收窄为 null
		expect(captured as string | null).toBe("hello");
	});

	it("无结构化 argv 时伪装称呼消息走常规解析", async () => {
		captured = null;
		bot.dispatch(createSession("slashy world") as never);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(captured as string | null).toBe("world");
	});

	it("before-parse 被短路时记录解析失败告警", async () => {
		captured = null;
		print.mockClear();
		// 首个监听器返回空串：bail 得到 falsy 的 argv（非 undefined 的 falsy
		// 才会短路后续钩子），空串不在监听器声明的返回类型中，经 unknown 收窄
		const dispose = app.before("parse", () => "" as unknown as undefined);
		bot.dispatch(createSession("slashy world") as never);
		await new Promise((resolve) => setTimeout(resolve, 10));
		dispose();
		expect(captured).toBeNull();
		expect(print.mock.calls[0]?.[0]).toMatch(
			/failed to parse interaction command/,
		);
	});
});

describe("Session Execute Edge Cases", () => {
	it("execute 按名找不到命令时告警并返回空", async () => {
		print.mockClear();
		const session = bot.session({ platform: "mock" }) as Session;
		await expect(session.execute({ name: "nonexistent" })).resolves.toEqual([]);
		expect(print.mock.calls[0]?.[0]).toMatch(/cannot find command/);
	});
});
