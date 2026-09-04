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
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `koishi-scripts build`（release/build.ts）的编排测试。
 *
 * cwd 与 runCommand 均被 mock：前者重定向到临时工作区，
 * 后者记录调用并按用例编程返回退出码，从而验证
 * 「枚举项目 → 探测包管理器 → 串行构建 → 失败即中断」的纯编排逻辑。
 */

const workspaceRoot = mkdtempSync(
	join(tmpdir(), "koishi-build-run-"),
);

mock.module("../index.ts", () => ({
	cwd: workspaceRoot,
	loadHostManifest: async () => null,
}));

/** runCommand 的调用记录 */
const calls: Array<{
	dir: string;
	cmd: string;
	args: readonly string[];
}> = [];

/** 各命令的编程退出码（键为 "cmd args"）；缺省 0 */
const exitCodes = new Map<string, number>();

mock.module("../release/run.ts", () => ({
	runCommand: (
		dir: string,
		cmd: string,
		args: readonly string[],
	) => {
		calls.push({ dir, cmd, args });
		return exitCodes.get(`${cmd} ${args.join(" ")}`) ?? 0;
	},
	captureCommand: () => null,
}));

const { default: runBuild } = await import(
	"../release/build.ts"
);

/** 收集 console.log 输出供断言 */
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

/** 在 external/ 下造一个项目 */
function seedProject(
	name: string,
	manifest: Record<string, unknown>,
	extraFiles: string[] = [],
): void {
	const dir = join(workspaceRoot, "external", name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify(manifest),
	);
	for (const file of extraFiles) {
		const path = join(dir, file);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, "");
	}
}

function resetWorkspace(): void {
	calls.length = 0;
	exitCodes.clear();
	logs.length = 0;
	rmSync(join(workspaceRoot, "external"), {
		recursive: true,
		force: true,
	});
	mkdirSync(join(workspaceRoot, "external"), {
		recursive: true,
	});
}

describe("runBuild", () => {
	it("无 external/ 目录时提示并返回 1", () => {
		resetWorkspace();
		rmSync(join(workspaceRoot, "external"), {
			recursive: true,
			force: true,
		});
		expect(runBuild()).toBe(1);
		expect(logs.join("\n")).toContain("无 external/");
		mkdirSync(join(workspaceRoot, "external"), {
			recursive: true,
		});
	});

	it("external/ 下无可构建项目时返回 0", () => {
		resetWorkspace();
		// 无清单目录 / 无 build 脚本项目均被跳过
		mkdirSync(
			join(workspaceRoot, "external", "no-manifest"),
			{
				recursive: true,
			},
		);
		seedProject("no-build-script", {
			name: "x",
			scripts: { test: "x" },
		});
		expect(runBuild()).toBe(0);
		expect(calls).toHaveLength(0);
		expect(logs.join("\n")).toContain(
			"无 build 脚本，跳过",
		);
	});

	it("按目录序串行构建 yarn 与 pnpm 项目", () => {
		resetWorkspace();
		seedProject("aaa-yarn", {
			name: "x",
			scripts: { build: "tsc" },
		});
		seedProject(
			"zzz-pnpm",
			{ name: "y", scripts: { build: "tsc" } },
			["pnpm-lock.yaml"],
		);
		expect(runBuild()).toBe(0);
		// yarn 成员走 yarn run build；pnpm monorepo 走 corepack pnpm run build
		expect(
			calls.map((c) => `${c.cmd} ${c.args.join(" ")}`),
		).toEqual([
			"yarn run build",
			"corepack pnpm run build",
		]);
		expect(calls[0]?.dir).toContain("aaa-yarn");
		expect(logs.join("\n")).toContain("全部完成：2 个项目");
	});

	it("任一项目失败即中断并透传退出码", () => {
		resetWorkspace();
		seedProject("aaa-fail", {
			name: "x",
			scripts: { build: "tsc" },
		});
		seedProject("zzz-never", {
			name: "y",
			scripts: { build: "tsc" },
		});
		exitCodes.set("yarn run build", 2);
		expect(runBuild()).toBe(2);
		// 只调用了失败的那个项目，后续项目不再构建
		expect(calls).toHaveLength(1);
		expect(logs.join("\n")).toContain("已中断");
	});

	it("workspace 清理核对（目录由 afterAll 删除）", () => {
		expect(existsSync(workspaceRoot)).toBe(true);
	});
});
