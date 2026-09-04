// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { describe, expect, it } from "bun:test";
import { interpolate } from "@koishi-ce/koishi";

/** 字符串工具（string.ts）的补充测试：interpolate 的边角分支 */

describe("interpolate 边角分支", () => {
	it("空占位符（{{}}）不构成表达式，原样保留并继续向后扫描", () => {
		expect(interpolate("a{{}}b{{ x }}", { x: 1 })).toBe(
			"a{{}}b1",
		);
		expect(interpolate("{{}}", { x: 1 })).toBe("{{}}");
	});

	it("缺少闭合定界符时剩余部分原样保留", () => {
		expect(interpolate("a{{ x", { x: 1 })).toBe("a{{ x");
		expect(
			interpolate("{{ x }} {{ y", { x: 1, y: 2 }),
		).toBe("1 {{ y");
	});

	it("支持自定义定界符（整串占位保留原始类型）", () => {
		expect(interpolate("$[x]", { x: 5 }, "$[", "]")).toBe(
			5,
		);
		expect(
			interpolate("a $[x] b", { x: 5 }, "$[", "]"),
		).toBe("a 5 b");
	});

	it("求值失败或空值在拼接场景替换为空串", () => {
		expect(interpolate("a{{ missing }}b", {})).toBe("ab");
		expect(interpolate("a{{ boom }}b", {})).toBe("ab");
	});

	it("连续多个占位符依次替换", () => {
		expect(
			interpolate("{{ a }}-{{ b }}-{{ a }}", {
				a: "x",
				b: "y",
			}),
		).toBe("x-y-x");
	});
});
