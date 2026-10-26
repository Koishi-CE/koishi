// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { expect, test } from "bun:test";
import type { ChangelogEntry } from "./notes.ts";
import {
	BULLET_LIMIT,
	clipBullet,
	formatNotes,
	parseChangelogDiff,
	splitEntries,
} from "./notes.ts";

const nameByPath = new Map([
	["packages/node/core", "@koishi-ce/core"],
	["plugins/webui/market", "@koishi-ce/plugin-market"],
]);

/** 造一段贴近真实的 `git diff --unified=0 -- '**\/CHANGELOG.md'` 输出。 */
const DIFF = [
	"diff --git a/packages/node/core/CHANGELOG.md b/packages/node/core/CHANGELOG.md",
	"index 1111111..2222222 100644",
	"--- a/packages/node/core/CHANGELOG.md",
	"+++ b/packages/node/core/CHANGELOG.md",
	"@@ -1,0 +2,8 @@",
	"+## 1.1.6",
	"+",
	"+### Patch Changes",
	"+",
	"+- 70a6c4d: Session 接口新增 sessionShadow 可选符号成员",
	"+  ",
	"+  类型层收敛，运行时零变化",
	"+- Updated dependencies [e537fa2]",
	"+  - @koishi-ce/utils@1.1.0",
	"+- @koishi-ce/koishi@1.0.20",
	"diff --git a/plugins/webui/market/CHANGELOG.md b/plugins/webui/market/CHANGELOG.md",
	"index 3333333..4444444 100644",
	"--- a/plugins/webui/market/CHANGELOG.md",
	"+++ b/plugins/webui/market/CHANGELOG.md",
	"@@ -1,0 +2,3 @@",
	"+## 1.4.5",
	"+",
	"+- 5b3ba34: 修复 unpublish 骨架包导致的依赖元数据刷新刷屏",
].join("\n");

test("解析 CHANGELOG diff：按路径归包、跳过依赖噪音、续行并入上一条", () => {
	const entries = parseChangelogDiff(DIFF, nameByPath);
	expect(entries).toEqual([
		{
			package: "@koishi-ce/core",
			text: "70a6c4d: Session 接口新增 sessionShadow 可选符号成员 类型层收敛，运行时零变化",
		},
		{
			package: "@koishi-ce/plugin-market",
			text: "5b3ba34: 修复 unpublish 骨架包导致的依赖元数据刷新刷屏",
		},
	] satisfies ChangelogEntry[]);
});

test("解析 CHANGELOG diff：未登记的路径整段忽略（不误归到上一个包）", () => {
	const unknown = DIFF.replaceAll(
		"b/packages/node/core/CHANGELOG.md",
		"b/packages/node/unknown/CHANGELOG.md",
	);
	const entries = parseChangelogDiff(unknown, nameByPath);
	expect(entries.map((entry) => entry.package)).toEqual([
		"@koishi-ce/plugin-market",
	]);
});

test("分组：跨包重复的条目单独成节、只出现一次，单包条目留在明细", () => {
	const { shared, scoped } = splitEntries([
		{
			package: "@koishi-ce/core",
			text: "e9258a1: 验证 OIDC 信任配置",
		},
		{
			package: "@koishi-ce/utils",
			text: "e9258a1: 验证 OIDC 信任配置",
		},
		{
			package: "@koishi-ce/utils",
			text: "13b6aff: coerce 不再退化成裸栈帧",
		},
	]);
	expect(shared.map((entry) => entry.text)).toEqual([
		"e9258a1: 验证 OIDC 信任配置",
	]);
	expect(scoped.map((entry) => entry.text)).toEqual([
		"13b6aff: coerce 不再退化成裸栈帧",
	]);
});

test("截断：短条目原样保留，超长条目按上限截断并标注出处", () => {
	const short = "a".repeat(BULLET_LIMIT);
	expect(clipBullet(short)).toBe(short);
	const long = "b".repeat(BULLET_LIMIT + 1);
	expect(clipBullet(long)).toBe(
		`${"b".repeat(BULLET_LIMIT)}…（详见 CHANGELOG）`,
	);
});

test("骨架：区间内没有升版时给出一句话而不是空表", () => {
	const notes = formatNotes({
		tag: "milestone/1.2",
		previousTag: "v1.1.8",
		commits: 3,
		bumps: [],
		entries: [],
		pulls: [],
	});
	expect(notes).toContain("本区间没有包升版。");
	expect(notes).not.toContain("| 包 | 版本 |");
});

test("骨架：版本表、跨包节、按包分节、PR 折叠块与安装说明齐备", () => {
	const notes = formatNotes({
		tag: "v1.1.8",
		previousTag: "v1.1.5",
		commits: 243,
		bumps: [
			{
				name: "@koishi-ce/core",
				before: "1.1.5",
				after: "1.1.8",
			},
			{
				name: "@koishi-ce/new",
				before: null,
				after: "1.0.0",
			},
		],
		entries: [
			{
				package: "@koishi-ce/core",
				text: "70a6c4d: 新增 sessionShadow",
			},
			{
				package: "@koishi-ce/core",
				text: "e9258a1: 信任配置验证",
			},
			{
				package: "@koishi-ce/new",
				text: "e9258a1: 信任配置验证",
			},
		],
		pulls: ["#73 fix(build): 加 NODE_OPTIONS 堆上限"],
	});
	expect(notes).toContain(
		"| `@koishi-ce/core` | 1.1.5 → 1.1.8 |",
	);
	expect(notes).toContain(
		"| `@koishi-ce/new` | 首发 1.0.0 |",
	);
	expect(notes).toContain(
		"## 跨包批量变更\n\n- e9258a1: 信任配置验证",
	);
	expect(notes).toContain(
		"### `@koishi-ce/core`（1.1.5 → 1.1.8）",
	);
	expect(notes).toContain("<summary>区间内合并的 PR（1 条");
	expect(notes).toContain("## 安装");
	expect(notes).toContain("自 `v1.1.5` 以来 243 个提交");
});
