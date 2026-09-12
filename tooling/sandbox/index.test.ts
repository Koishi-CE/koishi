// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { afterAll, describe, expect, test } from "bun:test";
/**
 * 外部沙盒实例生成器的测试：参数解析、workspace 枚举、链接计划与执行、
 * 沙盒 package.json 生成。junction 相关用例走真实文件系统（win32 下
 * junction 不需要特权）。
 */
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgv } from "./args.ts";
import { applyLinks, planLinks } from "./links.ts";
import { buildSandboxPackageJson } from "./manifest.ts";
import { resolveWorkspacePackages } from "./workspace.ts";

let root: string;

/** 在临时目录里写一个最小 package.json。 */
function writePackage(dir: string, name: string) {
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({ name }),
	);
}

afterAll(() => {
	if (root) rmSync(root, { recursive: true, force: true });
});

describe("parseArgv", () => {
	test("空参数：默认链接模式", () => {
		// toEqual 忽略 undefined 属性，故无需显式断言 target 缺省
		expect(parseArgv([])).toEqual({
			pack: false,
			force: false,
		});
	});

	test("位置参数、旗标与 -- 分隔符", () => {
		expect(parseArgv(["/tmp/box"])).toEqual({
			target: "/tmp/box",
			pack: false,
			force: false,
		});
		expect(
			parseArgv(["/tmp/box", "--pack", "--force"]),
		).toEqual({
			target: "/tmp/box",
			pack: true,
			force: true,
		});
		// bun run 可能插入的 -- 透传分隔符应被忽略
		expect(parseArgv(["--", "--pack"])).toEqual({
			pack: true,
			force: false,
		});
	});

	test("未知旗标与多余位置参数报错", () => {
		expect(() => parseArgv(["--banner"])).toThrow();
		expect(() => parseArgv(["a", "b"])).toThrow();
	});
});

describe("resolveWorkspacePackages", () => {
	test("按 workspaces 声明枚举，跳过无 package.json 的目录", () => {
		root = mkdtempSync(
			join(tmpdir(), "koishi-ce-sandbox-test-"),
		);
		writePackage(join(root, "pkgs/one"), "@koishi-ce/one");
		writePackage(join(root, "pkgs/two"), "@koishi-ce/two");
		writePackage(join(root, "apps/tool"), "create-x");
		// 无 package.json 的目录与散文件应被跳过
		mkdirSync(join(root, "pkgs/nopkg"), {
			recursive: true,
		});
		writeFileSync(join(root, "apps/loose.ts"), "");
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({ workspaces: ["pkgs/*", "apps/*"] }),
		);
		const packages = resolveWorkspacePackages(root);
		expect(packages.map((pkg) => pkg.name).sort()).toEqual([
			"@koishi-ce/one",
			"@koishi-ce/two",
			"create-x",
		]);
	});
});

describe("planLinks / applyLinks", () => {
	test("新建、复用、重建、实体让位、悬空重建、非 CE 作用域跳过", () => {
		const work = mkdtempSync(
			join(tmpdir(), "koishi-ce-sandbox-plan-"),
		);
		try {
			const nodeModules = join(work, "node_modules");
			const dirA = join(work, "src-a");
			const dirB = join(work, "src-b");
			mkdirSync(dirA, { recursive: true });
			mkdirSync(dirB, { recursive: true });
			const packages = [
				{ name: "@koishi-ce/alpha", dir: dirA },
				{ name: "@koishi-ce/beta", dir: dirB },
				{ name: "create-x", dir: dirB },
			];

			// 首次计划：CE 作用域 create，非 CE 作用域不进计划
			let plan = planLinks(packages, nodeModules);
			expect(plan.map((entry) => entry.action)).toEqual([
				"create",
				"create",
			]);
			expect(applyLinks(plan)).toEqual({
				create: 2,
				keep: 0,
				rebuild: 0,
				"skip-entity": 0,
			});
			const link = join(nodeModules, "@koishi-ce/alpha");
			expect(realpathSync(link).toLowerCase()).toBe(
				dirA.toLowerCase(),
			);

			// 已一致 → keep
			plan = planLinks(packages, nodeModules);
			expect(plan[0]?.action).toBe("keep");

			// 指向错误 → rebuild，执行后修正
			rmSync(link);
			symlinkSync(dirB, link, "junction");
			expect(
				planLinks(packages, nodeModules)[0]?.action,
			).toBe("rebuild");
			applyLinks(planLinks(packages, nodeModules));
			expect(realpathSync(link).toLowerCase()).toBe(
				dirA.toLowerCase(),
			);

			// 实体目录占位 → skip-entity 且不被覆盖
			const entity = join(nodeModules, "@koishi-ce/alpha");
			rmSync(link);
			mkdirSync(entity, { recursive: true });
			const marker = join(entity, "keep.txt");
			writeFileSync(marker, "npm");
			expect(
				planLinks(packages, nodeModules)[0]?.action,
			).toBe("skip-entity");
			applyLinks(planLinks(packages, nodeModules));
			expect(existsSync(marker)).toBeTrue();

			// 悬空 junction（目标已删除）→ rebuild
			const ghost = join(work, "ghost");
			mkdirSync(ghost, { recursive: true });
			const dangling = join(nodeModules, "@koishi-ce/beta");
			rmSync(dangling, { recursive: true, force: true });
			symlinkSync(ghost, dangling, "junction");
			rmSync(ghost, { recursive: true, force: true });
			expect(
				planLinks(packages, nodeModules)[1]?.action,
			).toBe("rebuild");
		} finally {
			rmSync(work, { recursive: true, force: true });
		}
	});
});

describe("buildSandboxPackageJson", () => {
	test("链接模式：入口直指 cli 产物，预声明默认插件依赖", () => {
		const manifest = buildSandboxPackageJson("link") as {
			scripts: { start: string };
			dependencies: Record<string, string>;
		};
		expect(manifest.scripts.start).toContain(
			"node_modules/@koishi-ce/koishi/lib/cli/index.mjs",
		);
		// loader 的 manifest 迁移发现宿主未声明这些插件会自动补挂并改写
		// koishi.yml（duplicate plugin 警告），须预声明堵住
		expect(
			Object.keys(manifest.dependencies).sort(),
		).toEqual([
			"@koishi-ce/plugin-http",
			"@koishi-ce/plugin-proxy-agent",
			"@koishi-ce/plugin-server",
		]);
	});

	test("打包模式：全部 tgz 以 file: 声明", () => {
		const manifest = buildSandboxPackageJson("pack", [
			{
				name: "@koishi-ce/core",
				file: "koishi-ce-core-1.0.0.tgz",
			},
		]) as {
			dependencies: Record<string, string>;
		};
		expect(manifest.dependencies).toEqual({
			"@koishi-ce/core":
				"file:./vendor/koishi-ce-core-1.0.0.tgz",
		});
	});
});
