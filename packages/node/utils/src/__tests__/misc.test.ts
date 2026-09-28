// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { describe, expect, it } from "bun:test";
import {
	assertProperty,
	coerce,
	enumKeys,
} from "@koishi-ce/koishi";

/** 杂项工具函数（misc.ts）的单元测试 */
describe("Miscellaneous", () => {
	// 验证 coerce 能把字符串与 Error 统一格式化为以 "Error: 消息" 开头的堆栈文本
	it("coerce", () => {
		expect(coerce("foo")).toMatch(/^Error: foo/);
		expect(coerce(new Error("foo"))).toMatch(/^Error: foo/);
	});

	// 消息含换行时的定位回退：实测现场是把一次 coerce 的文本再包成 Error
	// （消息本身成了多行栈文本），旧实现 findIndex 得 -1、slice(-1) 只留下
	// 最外层栈帧，调用方拿到的错误文本退化成一行「    at ...」
	it("coerce 消息含换行时仍从消息首行开始返回", () => {
		const inner = coerce(new Error("foo"));
		const text = coerce(new Error(inner));
		expect(text.split("\n")[0]).toBe(
			`Error: ${inner.split("\n")[0]}`,
		);
		expect(text).toContain("foo");
	});

	// 栈里根本找不到消息（栈被替换）时的兜底：消息必须回到首行
	it("coerce 栈中找不到消息时把消息补回首行", () => {
		const error = new Error("请先登录。");
		error.stack =
			"Error: 别的消息\n    at foo (bar.ts:1:1)";
		const text = coerce(error);
		expect(text.split("\n")[0]).toBe("请先登录。");
		expect(text).toContain("at foo (bar.ts:1:1)");
	});

	// 验证 enumKeys 能过滤掉数字值的键，仅保留字符串值的键
	it("enumKeys", () => {
		const Foo = { bar: 0, baz: 1, qux: "qux" } as const;
		expect(enumKeys(Foo)).toEqual(["qux"]);
	});

	// 验证 assertProperty 正常返回存在的属性、缺失时抛出带键名的错误
	it("assertProperty", () => {
		expect(assertProperty({ foo: "bar" }, "foo")).toBe(
			"bar",
		);
		expect(() =>
			assertProperty({}, "foo" as never),
		).toThrow('missing configuration "foo"');
	});
});
