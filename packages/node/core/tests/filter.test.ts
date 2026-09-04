// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 过滤器（Selector API）测试。
 *
 * 构造群聊（session1）与私聊（session2）两个会话，
 * 验证 ctx.user / guild / private 等选择器方法的过滤语义
 * 及其链式组合、交集行为是否符合预期。
 */
import { describe, expect, it } from "bun:test";
import { Context } from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";

const app = new Context();

app.plugin(mock);

const bot = app.bots[0]!;

// 群聊会话：userId 123，频道与群同号 456
const session1 = bot.session();
session1.userId = "123";
session1.channelId = "456";
session1.guildId = "456";
session1.isDirect = false;

// 私聊会话：userId 与频道号相同（私聊的典型形态）
const session2 = bot.session();
session2.userId = "123";
session2.channelId = "123";
session2.isDirect = true;

describe("Selector API", () => {
	it("root context", () => {
		// 根上下文默认放行所有会话
		expect(app.filter(session1)).toBe(true);
		expect(app.filter(session2)).toBe(true);
	});

	it("context.prototype.user", () => {
		// 不带参数只要求有 userId；带参数则要求 userId 命中白名单
		expect(app.user().filter(session1)).toBe(true);
		expect(app.user().filter(session2)).toBe(true);
		expect(app.user("123").filter(session1)).toBe(true);
		expect(app.user("123").filter(session2)).toBe(true);
		expect(app.user("456").filter(session1)).toBe(false);
		expect(app.user("456").filter(session2)).toBe(false);
	});

	it("context.prototype.private", () => {
		// private 只放行私聊会话，可与 user 组合
		expect(app.private().filter(session1)).toBe(false);
		expect(app.private().filter(session2)).toBe(true);
		expect(app.private().user("123").filter(session1)).toBe(
			false,
		);
		expect(app.private().user("123").filter(session2)).toBe(
			true,
		);
		expect(app.private().user("456").filter(session1)).toBe(
			false,
		);
		expect(app.private().user("456").filter(session2)).toBe(
			false,
		);
	});

	it("context.prototype.guild", () => {
		// 不带参数要求群聊；带参数要求 guildId 命中（私聊无 guildId 不通过）
		expect(app.guild().filter(session1)).toBe(true);
		expect(app.guild().filter(session2)).toBe(false);
		expect(app.guild("123").filter(session1)).toBe(false);
		expect(app.guild("123").filter(session2)).toBe(false);
		expect(app.guild("456").filter(session1)).toBe(true);
		expect(app.guild("456").filter(session2)).toBe(false);
	});

	it("context chaining", () => {
		// 链式调用为交集语义，且与顺序无关
		expect(
			app.guild("456").user("123").filter(session1),
		).toBe(true);
		expect(
			app.guild("456").user("456").filter(session1),
		).toBe(false);
		expect(
			app.guild("123").user("123").filter(session1),
		).toBe(false);
		expect(
			app.user("123").guild("456").filter(session1),
		).toBe(true);
		expect(
			app.user("456").guild("456").filter(session1),
		).toBe(false);
		expect(
			app.user("123").guild("123").filter(session1),
		).toBe(false);
	});

	it("context intersection", () => {
		// 同名选择器多次调用同样取交集（白名单的交集）
		expect(
			app
				.guild("456", "789")
				.guild("123", "456")
				.filter(session1),
		).toBe(true);
		expect(
			app
				.guild("456", "789")
				.guild("123", "789")
				.filter(session1),
		).toBe(false);
		expect(
			app
				.guild("123", "789")
				.guild("123", "456")
				.filter(session1),
		).toBe(false);
		expect(
			app
				.user("123", "789")
				.user("123", "456")
				.filter(session1),
		).toBe(true);
		expect(
			app
				.user("456", "789")
				.user("123", "456")
				.filter(session1),
		).toBe(false);
		expect(
			app
				.user("123", "789")
				.user("456", "789")
				.filter(session1),
		).toBe(false);
	});
});
