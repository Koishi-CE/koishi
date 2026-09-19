// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

// 分组 / 过滤 / 计数视图纯函数的回归测试(不进 tsconfig.web 类型
// 检查,运行时由 bun test 覆盖)。

import { describe, expect, it } from "bun:test";
import {
	buildGroups,
	type DependencyItem,
	GROUP_ORDER,
	summarize,
} from "./dependency-groups.ts";

function item(
	name: string,
	kind: DependencyItem["kind"],
	extra: Partial<DependencyItem> = {},
): DependencyItem {
	return {
		name,
		kind,
		ignored: false,
		fetching: false,
		...extra,
	};
}

describe("buildGroups 分组视图", () => {
	const items = [
		item("cordis", "installed"),
		item("koishi-plugin-a", "updatable"),
		item("koishi-plugin-b", "installed"),
		item("ws-pkg", "local"),
	];

	it("按固定顺序组装并丢弃空分组", () => {
		const groups = buildGroups(items, "all", "");
		expect(groups.map((group) => group.key)).toEqual([
			"local",
			"updatable",
			"installed",
		]);
		// 组内顺序保持输入顺序
		expect(groups[2]?.items.map((i) => i.name)).toEqual([
			"cordis",
			"koishi-plugin-b",
		]);
	});

	it("过滤项按分类收窄", () => {
		const groups = buildGroups(items, "updatable", "");
		expect(groups).toHaveLength(1);
		expect(groups[0]?.items[0]?.name).toBe(
			"koishi-plugin-a",
		);
	});

	it("搜索词匹配全名与短名", () => {
		// 短名 plugin-b 可命中全名 koishi-plugin-b
		expect(
			buildGroups(items, "all", "plugin-b"),
		).toHaveLength(1);
		expect(
			buildGroups(items, "all", "cordis"),
		).toHaveLength(1);
		expect(buildGroups(items, "all", "zzz")).toHaveLength(
			0,
		);
		// 搜索词两端空白被裁剪
		expect(
			buildGroups(items, "all", "  cordis "),
		).toHaveLength(1);
	});
});

describe("summarize 计数与分组同源", () => {
	it("各分类计数、加载中计数与总数", () => {
		const items = [
			item("a", "pending"),
			item("b", "updatable"),
			item("c", "updatable"),
			item("d", "installed", { fetching: true }),
			item("e", "installed", { ignored: true }),
		];
		const summary = summarize(items);
		expect(summary.total).toBe(5);
		expect(summary.pending).toBe(1);
		expect(summary.updatable).toBe(2);
		expect(summary.installed).toBe(2);
		expect(summary.fetching).toBe(1);
		expect(summary.local).toBe(0);
	});

	it("分组顺序常量覆盖全部六态且无重复", () => {
		expect([...GROUP_ORDER].sort()).toEqual([
			"error",
			"installed",
			"invalid",
			"local",
			"pending",
			"updatable",
		]);
	});
});
