// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { describe, expect, it } from "bun:test";
import { escapeRegExp, interpolate } from "@koishi-ce/koishi";

/** 字符串工具（string.ts）的单元测试 */
describe("String Manipulations", () => {
	// 验证插值：混合拼接、缺省为空串、整串占位保留原始类型（undefined / 数字）
	it("interpolate", () => {
		expect(interpolate("foo{{ bar }}foo", { bar: "baz" })).toBe("foobazfoo");
		expect(interpolate("foo{{ bar }}foo", {})).toBe("foofoo");
		expect(interpolate("{{ bar }}", {})).toBe(undefined);
		expect(interpolate("{{ +bar }}", { bar: "2" })).toBe(2);
	});

	// 验证全部正则特殊字符都被正确转义（连字符转义为 \x2d）
	it("escape regexp", () => {
		expect(escapeRegExp("\\^$*+?.()|{}[]-")).toBe(
			"\\\\\\^\\$\\*\\+\\?\\.\\(\\)\\|\\{\\}\\[\\]\\x2d",
		);
	});
});
