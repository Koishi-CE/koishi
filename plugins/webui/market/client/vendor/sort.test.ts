// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

// 逻辑层排序域的纯函数回归测试。测试文件不进入 tsconfig.web
// 类型检查（见其 exclude），运行时由 bun test 覆盖。

import { describe, expect, test } from "bun:test";
import { comparators, getSorted } from "./sort.ts";
import { mockPackage, mockSearch } from "./test-utils.ts";

describe("getSorted", () => {
	const market = [
		mockSearch({
			package: mockPackage("koishi-plugin-a"),
			rating: 3,
		}),
		mockSearch({
			package: mockPackage("koishi-plugin-b"),
			rating: 9,
		}),
		mockSearch({
			deprecated: true,
			package: mockPackage("koishi-plugin-c"),
			rating: 10,
		}),
	];

	test("默认过滤 deprecated，show:deprecated 放行", () => {
		expect(
			getSorted(market, []).map((d) => d.rating),
		).toEqual([9, 3]);
		expect(
			getSorted(market, ["show:deprecated"]).map(
				(d) => d.rating,
			),
		).toEqual([10, 9, 3]);
	});

	test("sort:rating 与 -asc 控制顺序", () => {
		expect(
			getSorted(market, ["sort:rating"]).map(
				(d) => d.rating,
			),
		).toEqual([9, 3]);
		expect(
			getSorted(market, ["sort:rating-asc"]).map(
				(d) => d.rating,
			),
		).toEqual([3, 9]);
	});

	test("默认比较器按搜索词相似度加权", () => {
		const [first] = getSorted(market, ["b"]) ?? [];
		expect(first?.rating).toBe(9);
	});
});

describe("公共面锁定", () => {
	test("comparators 键序即筛选面板展示序，防误改名", () => {
		expect(Object.keys(comparators)).toEqual([
			"default",
			"rating",
			"download",
			"created",
			"updated",
		]);
	});
});
