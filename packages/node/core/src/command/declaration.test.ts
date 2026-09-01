// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 命令声明解析（declaration）补充测试：
 * resolveDomain 对正则 / 枚举数组的归一与转换失败路径、
 * parseValue 无会话时写入裸键错误（不组装本地化文案）、
 * parseDecl 的变长声明解析与 stripped 展示（贪婪类型替换为 "..."）。
 */
import { describe, expect, it } from "bun:test";
import { Context as App, type Argv } from "@koishi-ce/koishi";

const app = new App();

describe("Declaration", () => {
	it("正则 domain：命中通过、未命中抛错转错误文案", () => {
		const ok: Argv = {};
		expect(
			app.$commander.parseValue("123", "argument", ok, { type: /^\d+$/ }),
		).toBe("123");
		expect(ok.error).toBeUndefined();

		const bad: Argv = {};
		expect(
			app.$commander.parseValue("abc", "argument", bad, { type: /^\d+$/ }),
		).toBeUndefined();
		expect(bad.error).toBeTruthy();
	});

	it("枚举 domain：成员内通过、成员外抛错", () => {
		const ok: Argv = {};
		expect(
			app.$commander.parseValue("foo", "argument", ok, {
				type: ["foo", "bar"],
			}),
		).toBe("foo");
		const bad: Argv = {};
		expect(
			app.$commander.parseValue("baz", "argument", bad, {
				type: ["foo", "bar"],
			}),
		).toBeUndefined();
		expect(bad.error).toBeTruthy();
	});

	it("parseValue 无会话时写入裸键错误", () => {
		const argv: Argv = {};
		expect(
			app.$commander.parseValue("x", "argument", argv, {
				type: "number",
				name: "n",
			}),
		).toBeUndefined();
		expect(argv.error).toBe("internal.invalid-argument");
	});

	it("未注册的 domain 名归一为空配置（转换直通）", () => {
		const argv: Argv = {};
		// 未注册名不在 Type 联合中（运行时按字面量归一），经声明视图传入
		const decl = { type: "no-such-domain" } as unknown as Argv.Declaration;
		expect(
			app.$commander.parseValue("raw", "argument", argv, decl),
		).toBeUndefined();
	});

	it("parseDecl 变长声明与 stripped 展示", () => {
		const decls = app.$commander.parseDecl("<req> [...rest:text] opt");
		expect(decls[0]).toMatchObject({
			name: "req",
			required: true,
			variadic: false,
		});
		expect(decls[1]).toMatchObject({
			name: "rest",
			required: false,
			variadic: true,
			type: "text",
		});
		// text 为贪婪类型：类型标注 ":text" 替换为 "..."（声明的 "..." 前缀保留）
		expect(decls.stripped).toBe("<req> [...rest...] opt");
	});
});
