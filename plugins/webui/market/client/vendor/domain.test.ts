// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

// 逻辑层领域模型（徽标 / 分类 / 注入契约）的纯函数回归测试。
// 测试文件不进入 tsconfig.web 类型检查（见其 exclude），运行时由 bun test 覆盖。

import { describe, expect, test } from "bun:test";
import {
	badges,
	categories,
	resolveCategory,
} from "./domain.ts";

describe("resolveCategory", () => {
	test("已知分类透传，未知兜底 other", () => {
		expect(resolveCategory("adapter")).toBe("adapter");
		expect(resolveCategory("nonexistent")).toBe("other");
		expect(resolveCategory(undefined)).toBe("other");
	});
});

describe("公共面锁定", () => {
	test("badges / categories 键序即筛选面板展示序，防误改名", () => {
		expect(Object.keys(badges)).toEqual([
			"installed",
			"verified",
			"insecure",
			"preview",
			"portable",
			"newborn",
		]);
		expect(categories).toHaveLength(14);
	});
});
