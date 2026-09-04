// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { expect, test } from "bun:test";
import type { PkgInfo } from "./workspace.ts";
import { topoSort } from "./workspace.ts";

/** 造一个最小 PkgInfo（发布序测试只关心依赖字段）。 */
function pkg(
	name: string,
	fields: {
		dependencies?: Record<string, string>;
		peerDependencies?: Record<string, string>;
		optionalDependencies?: Record<string, string>;
	} = {},
): PkgInfo {
	return {
		name,
		version: "1.0.0",
		dir: `/tmp/${name}`,
		manifestPath: `/tmp/${name}/package.json`,
		dependencies: fields.dependencies ?? {},
		peerDependencies: fields.peerDependencies ?? {},
		optionalDependencies: fields.optionalDependencies ?? {},
		files: [],
	};
}

test("发布序：框架依赖插件、插件 peer 框架（互指）不构成环，依赖方在前", () => {
	// 本仓实况的抽象：@koishi-ce/koishi 依赖 plugin-server，
	// plugin-server 又 peer koishi——peer 纳入排序边曾让发布链
	// 整体中断（"内部依赖存在环"），是本用例锁定的回归点
	const ordered = topoSort([
		pkg("@koishi-ce/koishi", {
			dependencies: {
				"@koishi-ce/plugin-server": "workspace:*",
			},
		}),
		pkg("@koishi-ce/plugin-server", {
			peerDependencies: { "@koishi-ce/koishi": "^1.0.0" },
		}),
	]);
	expect(ordered.map((item) => item.name)).toEqual([
		"@koishi-ce/plugin-server",
		"@koishi-ce/koishi",
	]);
});

test("发布序：纯 peer 边不产生顺序约束，双方均可立即发布", () => {
	const ordered = topoSort([
		pkg("@koishi-ce/plugin-a", {
			peerDependencies: { "@koishi-ce/plugin-b": "^1.0.0" },
		}),
		pkg("@koishi-ce/plugin-b"),
	]);
	expect(ordered).toHaveLength(2);
});

test("发布序：真实依赖成环仍抛错（环检测不因放宽 peer 而失效）", () => {
	expect(() =>
		topoSort([
			pkg("@koishi-ce/plugin-a", {
				dependencies: {
					"@koishi-ce/plugin-b": "workspace:*",
				},
			}),
			pkg("@koishi-ce/plugin-b", {
				dependencies: {
					"@koishi-ce/plugin-a": "workspace:*",
				},
			}),
		]),
	).toThrow("内部依赖存在环");
});
