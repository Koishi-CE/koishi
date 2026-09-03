// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * KoishiBot（对 satori Bot 的扩展）测试。
 *
 * 覆盖两个注入能力：
 * - getGuildMemberMap：把成员迭代器拍平成 userId -> 昵称映射，
 *   昵称优先级为群昵称 > 用户名 > userId；
 * - broadcast：按频道列表批量发送，支持字符串 / [guildId, channelId]
 *   元组 / Session 三种形态，带限速间隔且单条失败不中断。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { App, Logger } from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";

const app = new App();
app.plugin(mock);
const bot = app.bots[0]!;

// 记录 sendMessage 调用参数的包装器（broadcast 断言用）
type SendCall = {
	channelId: string;
	content: unknown;
	referrer: unknown;
	options: unknown;
};
let sendCalls: SendCall[] = [];

function wrapSend(impl?: (channelId: string) => string[] | Promise<string[]>) {
	sendCalls = [];
	// bot 实例可能被 cordis 的 traceable 代理包裹，直接赋值会触发
	// 其 set 陷阱，改用 defineProperty 在实例上覆盖
	Object.defineProperty(bot, "sendMessage", {
		value: async (
			channelId: string,
			content: unknown,
			referrer?: unknown,
			options?: unknown,
		) => {
			sendCalls.push({ channelId, content, referrer, options });
			return impl ? impl(channelId) : ["id1"];
		},
		configurable: true,
	});
}

function restoreSend() {
	delete (bot as { sendMessage?: unknown }).sendMessage;
}

beforeAll(() => app.start());
afterAll(async () => {
	restoreSend();
	await app.stop();
});

afterEach(() => {
	sendCalls = [];
	restoreSend();
});

describe("Bot Extensions", () => {
	it("getGuildMemberMap 昵称取值优先级", async () => {
		// 群昵称 > 用户名 > userId 兜底；无 user 的条目被跳过
		bot.getGuildMemberIter = async function* () {
			yield { name: "nick", user: { id: "1", name: "u1" } };
			yield { user: { id: "2", name: "u2" } };
			yield { user: { id: "3" } };
			yield { name: "ghost" };
		} as unknown as typeof bot.getGuildMemberIter;
		await expect(bot.getGuildMemberMap("guild")).resolves.toEqual({
			1: "nick",
			2: "u2",
			3: "3",
		});
	});

	it("broadcast 字符串频道形态", async () => {
		wrapSend();
		await expect(bot.broadcast(["ch1"], "hello")).resolves.toEqual(["id1"]);
		expect(sendCalls).toEqual([
			{
				channelId: "ch1",
				content: "hello",
				referrer: undefined,
				options: undefined,
			},
		]);
	});

	it("broadcast 元组频道形态", async () => {
		wrapSend();
		// [guildId, channelId] 元组：guildId 作为发送频道，channelId 作为 referrer
		await bot.broadcast([["guild1", "ch1"]], "hello");
		expect(sendCalls).toEqual([
			{
				channelId: "guild1",
				content: "hello",
				referrer: "ch1",
				options: undefined,
			},
		]);
	});

	it("broadcast 会话频道形态", async () => {
		wrapSend();
		const session = bot.session({
			channel: { id: "ch1", type: 0 },
			guild: { id: "guild1" },
		});
		session.channelId = "ch1";
		session.guildId = "guild1";
		await bot.broadcast([session], "hello");
		// 会话形态：以 session.channelId 发送并携带 guildId 与 session 上下文
		expect(sendCalls).toEqual([
			{
				channelId: "ch1",
				content: "hello",
				referrer: "guild1",
				options: { session },
			},
		]);
	});

	it("broadcast 单条失败不中断后续发送", async () => {
		// 单条失败的 bot 域告警是被测行为的预期伴生输出，静默之
		(Logger.levels as Record<string, number>)["bot"] = 0;
		try {
			wrapSend((channelId) => {
				if (channelId === "bad") throw new Error("send failed");
				return ["id1"];
			});
			// delay 取根配置 delay.broadcast，这里调小以加快用例
			app.root.config.delay!.broadcast = 0;
			const ids = await bot.broadcast(["bad", "good"], "hello");
			expect(ids).toEqual(["id1"]);
			expect(sendCalls).toHaveLength(2);
		} finally {
			delete (Logger.levels as Record<string, number>)["bot"];
		}
	});

	it("broadcast 相邻消息按 delay 限速", async () => {
		wrapSend((channelId) => [channelId]);
		app.root.config.delay!.broadcast = 10;
		const start = Date.now();
		const ids = await bot.broadcast(["a", "b"], "hello");
		const elapsed = Date.now() - start;
		// 首条不等待，第二条间隔约 10ms
		expect(ids).toEqual(["a", "b"]);
		expect(elapsed).toBeGreaterThanOrEqual(8);
		app.root.config.delay!.broadcast = 0;
	});
});
