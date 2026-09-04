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
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `koishi-scripts version`（release/version.ts）的编排测试。
 *
 * cwd 与 runCommand 均 mock（同 release-build.test.ts 的手法），
 * 重点覆盖 pending changeset 判定、changeset 二进制的三级解析
 * （项目本地 → 工作区根 → PATH 兜底）与失败即中断。
 */

const workspaceRoot = mkdtempSync(
	join(tmpdir(), "koishi-version-run-"),
);

mock.module("../index.ts", () => ({
	cwd: workspaceRoot,
	loadHostManifest: async () => null,
}));

const calls: Array<{
	dir: string;
	cmd: string;
	args: readonly string[];
}> = [];
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

const { default: runVersion } = await import(
	"../release/version.ts"
);

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

/** 平台对应的 bin 扩展名（win32 为 .cmd 批处理） */
const binExt = process.platform === "win32" ? ".cmd" : "";

/** 在 external/ 下造一个项目，返回其目录 */
function seedProject(
	name: string,
	changesetFiles: string[] = [],
): string {
	const dir = join(workspaceRoot, "external", name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({ name: "x" }),
	);
	if (changesetFiles.length > 0) {
		mkdirSync(join(dir, ".changeset"), { recursive: true });
		for (const file of changesetFiles) {
			writeFileSync(
				join(dir, ".changeset", file),
				"---\nx: patch\n---\n",
			);
		}
	}
	return dir;
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
	rmSync(join(workspaceRoot, "node_modules"), {
		recursive: true,
		force: true,
	});
}

describe("runVersion", () => {
	it("无 external/ 目录时提示并返回 1", () => {
		resetWorkspace();
		rmSync(join(workspaceRoot, "external"), {
			recursive: true,
			force: true,
		});
		expect(runVersion()).toBe(1);
		expect(logs.join("\n")).toContain("无 external/");
		mkdirSync(join(workspaceRoot, "external"), {
			recursive: true,
		});
	});

	it("external/ 下无任何项目（无 package.json）时返回 0", () => {
		resetWorkspace();
		mkdirSync(
			join(workspaceRoot, "external", "only-a-dir"),
			{
				recursive: true,
			},
		);
		expect(runVersion()).toBe(0);
		expect(calls).toHaveLength(0);
		expect(logs.join("\n")).toContain("未发现任何项目");
	});

	it("无项目 / 无 pending changeset 的项目均跳过", () => {
		resetWorkspace();
		mkdirSync(
			join(workspaceRoot, "external", "no-manifest"),
			{
				recursive: true,
			},
		);
		seedProject("no-changeset-dir");
		seedProject("only-readme", ["README.md", "notes.txt"]);
		seedProject("uppercase-readme", ["README.MD"]);
		expect(runVersion()).toBe(0);
		expect(calls).toHaveLength(0);
		expect(logs.join("\n")).toContain(
			"无 pending changeset，跳过",
		);
	});

	it("有 pending 条目的项目执行 changeset version（项目本地 bin 优先）", () => {
		resetWorkspace();
		const dir = seedProject("with-pending", [
			"fix-something.md",
		]);
		const localBin = join(
			dir,
			"node_modules",
			".bin",
			`changeset${binExt}`,
		);
		mkdirSync(join(dir, "node_modules", ".bin"), {
			recursive: true,
		});
		writeFileSync(localBin, "");

		expect(runVersion()).toBe(0);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.cmd).toBe(localBin);
		expect(calls[0]?.args).toEqual(["version"]);
		expect(logs.join("\n")).toContain(
			"1/1 个项目消费了 changeset",
		);
	});

	it("项目本地无 bin 时回退工作区根 node_modules/.bin", () => {
		resetWorkspace();
		const dir = seedProject("fallback-root", ["feat.md"]);
		// 本地候选是一个目录（非文件）→ 跳过，继续回退
		mkdirSync(
			join(
				dir,
				"node_modules",
				".bin",
				`changeset${binExt}`,
			),
			{
				recursive: true,
			},
		);
		const rootBin = join(
			workspaceRoot,
			"node_modules",
			".bin",
			`changeset${binExt}`,
		);
		mkdirSync(join(workspaceRoot, "node_modules", ".bin"), {
			recursive: true,
		});
		writeFileSync(rootBin, "");
		expect(statSync(rootBin).isFile()).toBe(true);

		expect(runVersion()).toBe(0);
		expect(calls[0]?.cmd).toBe(rootBin);
	});

	it("两级候选均缺失时回退 PATH 上的裸名 changeset", () => {
		resetWorkspace();
		seedProject("fallback-path", ["chore.md"]);
		expect(runVersion()).toBe(0);
		expect(calls[0]?.cmd).toBe("changeset");
	});

	it("changeset version 失败即中断并透传退出码", () => {
		resetWorkspace();
		seedProject("fail-first", ["a.md"]);
		seedProject("never-second", ["b.md"]);
		exitCodes.set("changeset version", 3);
		expect(runVersion()).toBe(3);
		expect(calls).toHaveLength(1);
		expect(logs.join("\n")).toContain("已中断");
	});
});
