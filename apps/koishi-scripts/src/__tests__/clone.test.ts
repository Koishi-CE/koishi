// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import runClone from "../clone.ts";

/**
 * `koishi-scripts clone`（clone.ts）的行为测试。
 *
 * 通过 mock "../index.ts" 把宿主 cwd 重定向到临时目录，
 * Bun.spawnSync 以可写属性劫持为记录桩（不产生真实子进程），
 * 覆盖：仓库地址规范化、目录名推导、退出码传播与非交互报错。
 */

const workspaceRoot = mkdtempSync(
	join(tmpdir(), "koishi-clone-run-"),
);

mock.module("../index.ts", () => ({
	cwd: workspaceRoot,
}));

/** spawnSync 桩回执形态（对应 clone → install 两步按次出队） */
interface SpawnResult {
	success: boolean;
	exitCode: number | null;
}

/** spawnSync 桩收到的调用（cmd 及选项） */
const spawnCalls: Array<{
	cmd: string[];
	options: Record<string, unknown>;
}> = [];

/** 按次序出队的桩回执队列 */
const spawnResults: SpawnResult[] = [];

const logs: string[] = [];

const originalSpawnSync = Bun.spawnSync;
const originalLog = console.log;

beforeAll(() => {
	Bun.spawnSync = ((options: {
		cmd: string[];
	} & Record<string, unknown>) => {
		spawnCalls.push({
			cmd: options.cmd,
			options,
		});
		return (
			spawnResults.shift() ?? { success: true, exitCode: 0 }
		);
	}) as unknown as typeof Bun.spawnSync;
	console.log = (...args: unknown[]) => {
		logs.push(args.join(" "));
	};
});

afterAll(() => {
	Bun.spawnSync = originalSpawnSync;
	console.log = originalLog;
	rmSync(workspaceRoot, { recursive: true, force: true });
});

/** 单用例封装：重置桩状态（回执按需注入）后驱动 runClone */
async function run(
	args: readonly string[],
	results: SpawnResult[] = [],
) {
	spawnCalls.length = 0;
	spawnResults.length = 0;
	spawnResults.push(...results);
	logs.length = 0;
	return runClone(args);
}

/** 断言第一步 git clone 的命令行 */
function expectCloneCmd(repo: string, name: string) {
	expect(spawnCalls[0]?.cmd).toEqual([
		"git",
		"clone",
		repo,
		join("external", name),
	]);
}

describe("clone：仓库地址规范化", () => {
	it("owner/repo 补全为 https 地址并追加 .git", async () => {
		const code = await run(["koishi-ce/registry"]);
		expect(code).toBe(0);
		expectCloneCmd(
			"https://github.com/koishi-ce/registry.git",
			"registry",
		);
	});

	it("目录名去掉 koishi-plugin- 前缀", async () => {
		const code = await run(["koishijs/koishi-plugin-demo"]);
		expect(code).toBe(0);
		expectCloneCmd(
			"https://github.com/koishijs/koishi-plugin-demo.git",
			"demo",
		);
	});

	it("完整 https 地址原样保留（已带 .git）", async () => {
		const code = await run([
			"https://github.com/koishijs/koishi-plugin-demo.git",
		]);
		expect(code).toBe(0);
		expectCloneCmd(
			"https://github.com/koishijs/koishi-plugin-demo.git",
			"demo",
		);
	});

	it("https 地址缺 .git 时补齐", async () => {
		const code = await run(["https://github.com/foo/bar"]);
		expect(code).toBe(0);
		expectCloneCmd("https://github.com/foo/bar.git", "bar");
	});

	it("显式目录名优先于推导名", async () => {
		const code = await run(["foo/bar", "custom"]);
		expect(code).toBe(0);
		expectCloneCmd(
			"https://github.com/foo/bar.git",
			"custom",
		);
	});

	it("以 - 开头的参数不占位置参数位", async () => {
		const code = await run(["--flag", "foo/bar"]);
		expect(code).toBe(0);
		expectCloneCmd("https://github.com/foo/bar.git", "bar");
	});
});

describe("clone：安装与退出码", () => {
	it("成功路径：clone 后在宿主 cwd 执行 bun install，退出码 0", async () => {
		const code = await run(["foo/bar"]);
		expect(code).toBe(0);
		expect(spawnCalls[1]?.cmd).toEqual(["bun", "install"]);
		expect(spawnCalls[1]?.options["cwd"]).toBe(workspaceRoot);
		expect(logs.join("\n")).toContain("🎉 完成");
	});

	it("git clone 失败：返回其退出码且不执行安装", async () => {
		const code = await run(["foo/bar"], [
			{ success: false, exitCode: 128 },
		]);
		expect(code).toBe(128);
		expect(spawnCalls).toHaveLength(1);
		expect(logs.join("\n")).toContain("退出码 128");
	});

	it("git clone 失败且退出码为 null 时按 1 返回", async () => {
		const code = await run(["foo/bar"], [
			{ success: false, exitCode: null },
		]);
		expect(code).toBe(1);
	});

	it("bun install 失败：返回其退出码", async () => {
		const code = await run(
			["foo/bar"],
			[
				{ success: true, exitCode: 0 },
				{ success: false, exitCode: 1 },
			],
		);
		expect(code).toBe(1);
		expect(logs.join("\n")).toContain("bun install 失败");
	});
});

describe("clone：非交互环境", () => {
	it("缺仓库地址且非 TTY 时报错（不进入 ask 流程）", async () => {
		// bun test 的 stdin 恒非 TTY，ask 会直接抛错
		expect(run([])).rejects.toThrow("非交互环境");
	});

	it("仓库地址不匹配且无目录名时同样要求补全参数", async () => {
		// SSH 形态不在规范化白名单内，name 为空 → 走 ask → 非交互报错
		expect(
			run(["git@github.com:foo/bar.git"]),
		).rejects.toThrow("非交互环境");
	});
});
