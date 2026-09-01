// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 会话本地化层（SessionLocalized）测试。
 *
 * 覆盖 withScope 的相对路径改写与作用域恢复、resolveScope 的
 * 绝对 / 相对 / 缺失作用域三种情形，以及 i18n / text 的
 * "频道 -> 群 -> 用户"语言偏好合并（prefer-user / prefer-channel）。
 */
import { afterAll, beforeAll, describe, expect, it, jest } from "bun:test";
import { App, h, Logger, type Session } from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";

// prefer-user 与默认 prefer-channel 各一个应用
const appUser = new App({ i18n: { output: "prefer-user" } });
const appChannel = new App();
appUser.plugin(mock);
appChannel.plugin(mock);

appUser.i18n.define("ja-JP", "greet", "ジャ");
appUser.i18n.define("de-DE", "greet", "hallo");
appChannel.i18n.define("ja-JP", "greet", "ジャ");
appChannel.i18n.define("de-DE", "greet", "hallo");

// 捕获 i18n 通道的警告输出（missing scope 断言用）
const print = jest.fn();

beforeAll(() => {
	Logger.levels.base = 1;
	Logger.targets.push({ levels: { base: 0, i18n: 2 }, print });
	return Promise.all([appUser.start(), appChannel.start()]);
});

afterAll(async () => {
	Logger.levels.base = 2;
	Logger.targets.pop();
	await Promise.all([appUser.stop(), appChannel.stop()]);
});

describe("Session Locale", () => {
	it("withScope 把相对 i18n 路径拼接作用域前缀", async () => {
		const session = appUser.bots[0]!.session({}) as Session;
		const output = await session.withScope("sc.op", async () => [
			h.i18n({ path: ".rel" }),
		]);
		expect(output).toHaveLength(1);
		expect(output[0]?.attrs["path"]).toBe("sc.op.rel");
		// 回调结束后恢复原作用域（原本无作用域则删除）
		expect(session.scope).toBeUndefined();
	});

	it("withScope 绝对路径保持不变", async () => {
		const session = appUser.bots[0]!.session({}) as Session;
		const output = await session.withScope("sc.op", async () => [
			h.i18n({ path: "abs.path" }),
		]);
		expect(output[0]?.attrs["path"]).toBe("abs.path");
	});

	it("withScope 结束后恢复既有作用域而非删除", async () => {
		const session = appUser.bots[0]!.session({}) as Session;
		// 会话已带作用域时，withScope 结束应恢复原值
		session.scope = "outer";
		await session.withScope("inner.op", async () => [h.i18n({ path: ".x" })]);
		expect(session.scope).toBe("outer");
		delete (session as { scope?: string }).scope;
	});

	it("resolveScope 的三种情形", () => {
		const session = appUser.bots[0]!.session({}) as Session;
		// 绝对路径原样返回
		expect(session.resolveScope("a.b")).toBe("a.b");
		// 相对路径无作用域：警告并渲染为空
		print.mockClear();
		expect(session.resolveScope(".x")).toBe("");
		expect(print.mock.calls).toHaveLength(1);
		// 有作用域时拼接
		session.scope = "S";
		expect(session.resolveScope(".x")).toBe("S.x");
		delete (session as { scope?: string }).scope;
	});

	it("i18n 语言偏好合并：prefer-user", () => {
		const session = appUser.bots[0]!.session({}) as Session;
		(session as unknown as { user: object }).user = { locales: ["ja-JP"] };
		(session as unknown as { channel: object }).channel = {
			locales: ["de-DE"],
		};
		// 用户语言被提到频道语言之前
		expect(session.text("greet")).toBe("ジャ");
	});

	it("i18n 语言偏好合并：prefer-channel", () => {
		const session = appChannel.bots[0]!.session({}) as Session;
		(session as unknown as { user: object }).user = { locales: ["ja-JP"] };
		(session as unknown as { channel: object }).channel = {
			locales: ["de-DE"],
		};
		// 频道语言优先于用户语言
		expect(session.text("greet")).toBe("hallo");
	});

	it("会话自带 locales 永远最优先", () => {
		const session = appUser.bots[0]!.session({}) as Session;
		session.locales = ["de-DE"];
		(session as unknown as { user: object }).user = { locales: ["ja-JP"] };
		expect(session.text("greet")).toBe("hallo");
	});
});
