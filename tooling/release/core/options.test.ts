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

test("旗标：其余旗标逐一可解析（--dry-run / --allow-dirty / --skip-build / --skip-test）", () => {
	expect(parseOptions(["--dry-run"])?.dryRun).toBe(true);
	expect(parseOptions(["--allow-dirty"])?.allowDirty).toBe(
		true,
	);
	expect(parseOptions(["--skip-build"])?.skipBuild).toBe(
		true,
	);
	expect(parseOptions(["--skip-test"])?.skipTest).toBe(
		true,
	);
});

test("旗标：全部旗标同时给出时互不干扰（覆盖 switch 的每个分支）", () => {
	// 一次性走遍所有 case：既锁住「新增旗标不会挤掉旧旗标」，也让本文件
	// 行覆盖保持 100%（该文件进入覆盖率报告靠本测试 import，缺口会直接
	// 拉低 Codecov 的 patch/project 两个口径）
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
