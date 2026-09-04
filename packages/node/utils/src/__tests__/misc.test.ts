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
