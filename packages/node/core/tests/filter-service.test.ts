// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 过滤服务（FilterService）组合代数的补充测试。
 *
 * filter.test.ts 已覆盖 user / guild / private / intersect 链式组合，
 * 这里补齐其余组合方法：any / never / union / exclude 以及
 * self / platform 两个快捷筛选，并验证过滤器函数与上下文两种实参形态。
 */
import { describe, expect, it } from "bun:test";
import { Context as App, type Session } from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";

const app = new App();
app.plugin(mock);

const bot = app.bots[0]!;

// 构造一个带完整标识信息的会话，用于各筛选器的判定
function createSession(overrides: Partial<Session> = {}) {
	const session = bot.session({});
	session.userId = "123";
	session.selfId = bot.selfId;
	session.channelId = "456";
	session.guildId = "456";
	session.platform = "mock";
	session.isDirect = false;
	return Object.assign(session, overrides);
}

describe("Filter Combinators", () => {
	it("any / never 恒真与恒假", () => {
		const session = createSession();
		expect(app.any().filter(session)).toBe(true);
		expect(app.never().filter(session)).toBe(false);
	});

	it("union 并集语义", () => {
		const session = createSession();
		// 与拒绝全部的过滤器取并集：任一通过即通过
		expect(app.union(() => false).filter(session)).toBe(true);
		// never 与放行过滤器取并集：通过
		expect(
			app
				.never()
				.union(() => true)
				.filter(session),
		).toBe(true);
		// never 与恒假取并集：仍拒绝
		expect(
			app
				.never()
				.union(() => false)
				.filter(session),
		).toBe(false);
	});

	it("exclude 差集语义", () => {
		const session = createSession();
		// 根上下文放行全部，排除掉"userId 为 123"的会话后被拒
		expect(app.exclude((s) => s.userId === "123").filter(session)).toBe(false);
		// 排除不命中的过滤器则不受影响
		expect(app.exclude((s) => s.userId === "789").filter(session)).toBe(true);
		// 也接受另一上下文作为排除条件
		expect(app.exclude(app.user("789")).filter(session)).toBe(true);
	});

	it("union / intersect / exclude 接受 Context 实参", () => {
		const session = createSession();
		const rejected = app.never();
		const allowed = app.any();
		expect(app.union(rejected).filter(session)).toBe(true);
		expect(app.intersect(allowed).filter(session)).toBe(true);
		expect(app.intersect(rejected).filter(session)).toBe(false);
	});

	it("self 筛选机器人账号", () => {
		const session = createSession();
		expect(app.self(bot.selfId).filter(session)).toBe(true);
		expect(app.self("999").filter(session)).toBe(false);
	});

	it("platform 筛选平台", () => {
		const session = createSession();
		expect(app.platform("mock").filter(session)).toBe(true);
		expect(app.platform("discord").filter(session)).toBe(false);
	});

	it("channel 筛选频道", () => {
		const session = createSession();
		expect(app.channel("456").filter(session)).toBe(true);
		expect(app.channel("789").filter(session)).toBe(false);
	});
});
