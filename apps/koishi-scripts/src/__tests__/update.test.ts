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

/**
 * `koishi-scripts update`（update.ts）的编排测试。
 *
 * cwd / loadHostManifest / runCommand 均 mock（同 release-version.test.ts
 * 的手法），重点覆盖白名单口径：只更新 @koishi-ce/*，alias 冻结线
 * （koishi / @koishijs/*）、市场插件（koishi-plugin-*）与 bun-types
 * 一律不进命令行。
 */

const workspaceRoot = mkdtempSync(
	join(tmpdir(), "koishi-update-run-"),
);

/** 可变假清单：用例按需改字段 */
const hostManifest: Record<string, unknown> = {};

mock.module("../index.ts", () => ({
	cwd: workspaceRoot,
	loadHostManifest: async () =>
		Object.keys(hostManifest).length
			? (hostManifest as never)
			: null,
}));

const calls: Array<{
	dir: string;
	cmd: string;
	args: readonly string[];
}> = [];
let runExitCode = 0;

mock.module("../release/run.ts", () => ({
	runCommand: (
		dir: string,
		cmd: string,
		args: readonly string[],
	) => {
		calls.push({ dir, cmd, args });
		return runExitCode;
	},
	captureCommand: () => null,
}));

const { collectUpdateTargets, default: runUpdate } =
	await import("../update.ts");

const logs: string[] = [];
const originalLog = console.log;

beforeAll(() => {
	console.log = (...args: unknown[]) => {
		logs.push(args.map((arg) => `${arg}`).join(" "));
	};
});

afterAll(() => {
	console.log = originalLog;
	rmSync(workspaceRoot, { recursive: true, force: true });
});

function resetCase(
	manifest: Record<string, unknown> | null,
): void {
	calls.length = 0;
	logs.length = 0;
	runExitCode = 0;
	for (const key of Object.keys(hostManifest)) {
		delete hostManifest[key];
	}
	if (manifest) Object.assign(hostManifest, manifest);
}

/** 模板项目形态的宿主清单（含全部应被排除的干扰键） */
function templateLikeManifest(): Record<string, unknown> {
	return {
		dependencies: {
			"@koishi-ce/koishi": "^1.0.0",
			"@koishi-ce/plugin-config": "^1.0.0",
			"@koishi-ce/plugin-market": "^1.0.0",
			// alias 冻结线四行（上游名，不进白名单）
			koishi: "npm:@koishi-ce/koishi-shim@^4.18.11",
			"@koishijs/plugin-console":
				"npm:@koishi-ce/console-shim@^5.30.11",
			"@koishijs/core":
				"npm:@koishi-ce/koishi-shim@4.18.11",
			"@koishijs/loader":
				"npm:@koishi-ce/koishi-shim@^4.18.11",
			// 市场安装的第三方插件（经插件市场操作，不进白名单）
			"koishi-plugin-textgame-war": "^0.65.0",
		},
		devDependencies: {
			"@koishi-ce/client": "^1.0.0",
			"@koishi-ce/scripts": "^1.0.0",
			"bun-types": "^1.4.0",
		},
	};
}

describe("collectUpdateTargets", () => {
	it("只收集 @koishi-ce/* 键，合并 deps 与 devDeps 并排序去重", () => {
		expect(
			collectUpdateTargets(templateLikeManifest()),
		).toEqual([
			"@koishi-ce/client",
			"@koishi-ce/koishi",
			"@koishi-ce/plugin-config",
			"@koishi-ce/plugin-market",
			"@koishi-ce/scripts",
		]);
	});

	it("deps 与 devDeps 重复声明的包只保留一次", () => {
		expect(
			collectUpdateTargets({
				dependencies: { "@koishi-ce/koishi": "^1.0.0" },
				devDependencies: {
					"@koishi-ce/koishi": "^1.0.0",
					"@koishi-ce/client": "^1.0.0",
				},
			}),
		).toEqual(["@koishi-ce/client", "@koishi-ce/koishi"]);
	});

	it("空清单返回空数组", () => {
		expect(collectUpdateTargets({})).toEqual([]);
	});
});

describe("runUpdate", () => {
	it("宿主无 package.json 时提示并返回 1，不触发 bun", async () => {
		resetCase(null);
		expect(await runUpdate()).toBe(1);
		expect(calls).toHaveLength(0);
		expect(logs.join("\n")).toContain("无 package.json");
	});

	it("只对 @koishi-ce/* 白名单执行 bun update", async () => {
		resetCase(templateLikeManifest());
		expect(await runUpdate()).toBe(0);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.dir).toBe(workspaceRoot);
		expect(calls[0]?.cmd).toBe("bun");
		expect(calls[0]?.args).toEqual([
			"update",
			"@koishi-ce/client",
			"@koishi-ce/koishi",
			"@koishi-ce/plugin-config",
			"@koishi-ce/plugin-market",
			"@koishi-ce/scripts",
		]);
		const cmdline = calls[0]?.args.join(" ") ?? "";
		expect(cmdline).not.toContain("koishi-plugin-");
		expect(cmdline).not.toContain("@koishijs/");
		expect(cmdline).not.toContain(" bun-types");
		expect(logs.join("\n")).toContain(
			"alias 冻结线与市场插件不受影响",
		);
	});

	it("无 @koishi-ce/* 依赖时提示无需更新并返回 0", async () => {
		resetCase({
			dependencies: {
				koishi: "npm:@koishi-ce/koishi-shim@^4.18.11",
				"koishi-plugin-foo": "^1.0.0",
			},
		});
		expect(await runUpdate()).toBe(0);
		expect(calls).toHaveLength(0);
		expect(logs.join("\n")).toContain("无需更新");
	});

	it("bun update 失败时透传退出码并提示", async () => {
		resetCase(templateLikeManifest());
		runExitCode = 7;
		expect(await runUpdate()).toBe(7);
		expect(logs.join("\n")).toContain("退出码 7");
	});
});
