// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { expect, test } from "bun:test";
import { parseOptions } from "../options.ts";

test("旗标：默认全关；全部旗标同时给出时互不干扰", () => {
	// 回归点：CI 的 version job 跑 `release version --commit --push`，
	// 任一旗标不被识别都会让 parseOptions 返回 null、发布链直接退出
	expect(parseOptions([])).toEqual({
		dryRun: false,
		push: false,
		allowDirty: false,
		skipBuild: false,
		skipTest: false,
		commit: false,
		only: [],
	});
	expect(
		parseOptions([
			"--dry-run",
			"--only",
			"@koishi-ce/core",
			"--commit",
			"--push",
			"--allow-dirty",
			"--skip-build",
			"--skip-test",
		]),
	).toEqual({
		dryRun: true,
		push: true,
		allowDirty: true,
		skipBuild: true,
		skipTest: true,
		commit: true,
		only: ["@koishi-ce/core"],
	});
});

test("旗标：--only 按逗号切分并去空白", () => {
	expect(
		parseOptions([
			"--only",
			"@koishi-ce/core, @koishi-ce/utils ",
		])?.only,
	).toEqual(["@koishi-ce/core", "@koishi-ce/utils"]);
});

test("旗标：未知旗标 / --only 缺参或值以 -- 开头 / 位置参数 → null", () => {
	expect(parseOptions(["--nope"])).toBeNull();
	expect(parseOptions(["--only"])).toBeNull();
	expect(parseOptions(["--only", "--push"])).toBeNull();
	expect(parseOptions(["stray"])).toBeNull();
});
