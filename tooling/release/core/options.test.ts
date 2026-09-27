// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { expect, test } from "bun:test";
import { parseOptions } from "./options.ts";

test("旗标：默认全关，only 为空名单", () => {
	expect(parseOptions([])).toEqual({
		dryRun: false,
		push: false,
		allowDirty: false,
		skipBuild: false,
		skipTest: false,
		commit: false,
		only: [],
	});
});

test("旗标：--commit 与 --push 可同时给出（CI 拆分 job 的 version 环形态）", () => {
	// 回归点：ci 的 version job 跑 `release version --commit --push`，
	// 任一旗标不被识别都会让 parseOptions 返回 null、整条发布链直接退出
	const options = parseOptions(["--commit", "--push"]);
	expect(options?.commit).toBe(true);
	expect(options?.push).toBe(true);
});

test("旗标：--only 按逗号切分并去空白", () => {
	const options = parseOptions([
		"--only",
		"@koishi-ce/core, @koishi-ce/utils ",
	]);
	expect(options?.only).toEqual([
		"@koishi-ce/core",
		"@koishi-ce/utils",
	]);
});

test("旗标：未知旗标返回 null；--only 缺参或缺值同样返回 null", () => {
	expect(parseOptions(["--nope"])).toBeNull();
	expect(parseOptions(["--only"])).toBeNull();
	expect(parseOptions(["--only", "--push"])).toBeNull();
});
