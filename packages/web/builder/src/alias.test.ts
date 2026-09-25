// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * collectWorkspaceAliases（工作区别名计算）的单元测试。
 *
 * 以临时目录构造 workspace 形态的 fixture，直接调用被测函数
 * （repoRoot 参数注入），覆盖：多 pattern 扫描、裸名入口优先级
 * （client 优先于 src）、无入口包跳过、包级清单损坏跳过并留痕、
 * 仓库根清单缺失的空表语义与清单损坏的可观测降级。
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectWorkspaceAliases } from "./alias.ts";

/** 归一为正斜杠便于断言（scanSync 在 Windows 上产出反斜杠路径） */
function normalize(value: string) {
	return value.replaceAll("\\", "/");
}

let cleanup: string | undefined;

afterEach(async () => {
	if (cleanup) {
		await rm(cleanup, { recursive: true, force: true });
		cleanup = undefined;
	}
});

/** 在临时目录创建一个工作区包（可选写入 src / client 入口目录） */
async function makePackage(
	root: string,
	dir: string,
	manifest: string,
	layout: ("src" | "client")[] = [],
) {
	const pkgDir = join(root, dir);
	await mkdir(pkgDir, { recursive: true });
	await writeFile(join(pkgDir, "package.json"), manifest);
	for (const kind of layout) {
		await mkdir(join(pkgDir, kind), { recursive: true });
		await writeFile(
			join(pkgDir, kind, "index.ts"),
			"export {}",
		);
	}
}

/** 搭一个完整 fixture：返回别名表中所有值的可读形态（相对 root） */
async function makeFixture(brokenRootManifest = false) {
	const root = join(
		tmpdir(),
		`console-builder-alias-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
	);
	cleanup = root;
	await mkdir(root, { recursive: true });
	await writeFile(
		join(root, "package.json"),
		brokenRootManifest
			? "{ broken json"
			: JSON.stringify({
					workspaces: ["pkgs/*", "plugins/*"],
				}),
	);
	await makePackage(
		root,
		"pkgs/lib-pkg",
		'{"name":"@t/lib-pkg"}',
		["src"],
	);
	await makePackage(
		root,
		"pkgs/client-pkg",
		'{"name":"@t/client-pkg"}',
		["client"],
	);
	await makePackage(
		root,
		"pkgs/both-pkg",
		'{"name":"@t/both-pkg"}',
		["src", "client"],
	);
	// 无 src/ 无 client/ 的包：不建别名
	await makePackage(
		root,
		"pkgs/empty-pkg",
		'{"name":"@t/empty-pkg"}',
	);
	// 清单损坏的包：跳过并 warn
	await makePackage(root, "pkgs/broken-pkg", "{ broken");
	// 第二个 pattern 形态：无 name 字段的包同样不建别名
	await makePackage(root, "plugins/noname", "{}", ["src"]);
	return root;
}

describe("collectWorkspaceAliases", () => {
	it("多 pattern 扫描：按入口形态生成别名，client 优先于 src", async () => {
		const root = await makeFixture();
		const aliases = await collectWorkspaceAliases(root);

		// 仅 src 的库包：裸名与 /src 子路径都指向源码目录
		expect(normalize(aliases["@t/lib-pkg"]!)).toBe(
			`${normalize(root)}/pkgs/lib-pkg/src/index.ts`,
		);
		expect(normalize(aliases["@t/lib-pkg/src"]!)).toBe(
			`${normalize(root)}/pkgs/lib-pkg/src`,
		);
		expect(aliases["@t/lib-pkg/client"]).toBeUndefined();

		// 仅 client 的包：裸名与 /client 子路径都指向浏览器端入口
		// （/src 子路径映射目录、/client 子路径映射入口文件，系原实现形态）
		expect(normalize(aliases["@t/client-pkg"]!)).toBe(
			`${normalize(root)}/pkgs/client-pkg/client/index.ts`,
		);
		expect(
			normalize(aliases["@t/client-pkg/client"]!),
		).toBe(
			`${normalize(root)}/pkgs/client-pkg/client/index.ts`,
		);
		expect(aliases["@t/client-pkg/src"]).toBeUndefined();

		// 双入口的插件包：裸名落 client，两个子路径各归各位
		expect(normalize(aliases["@t/both-pkg"]!)).toBe(
			`${normalize(root)}/pkgs/both-pkg/client/index.ts`,
		);
		expect(normalize(aliases["@t/both-pkg/src"]!)).toBe(
			`${normalize(root)}/pkgs/both-pkg/src`,
		);
		expect(normalize(aliases["@t/both-pkg/client"]!)).toBe(
			`${normalize(root)}/pkgs/both-pkg/client/index.ts`,
		);

		// 无入口 / 无 name 的包不建别名
		expect(aliases["@t/empty-pkg"]).toBeUndefined();
		expect(aliases["plugins/noname"]).toBeUndefined();
	});

	it("子路径键先于裸名插入（别名解析按插入序取首个命中项）", async () => {
		const root = await makeFixture();
		const aliases = await collectWorkspaceAliases(root);
		expect(
			Object.keys(aliases).filter((key) =>
				key.startsWith("@t/both-pkg"),
			),
		).toEqual([
			"@t/both-pkg/src",
			"@t/both-pkg/client",
			"@t/both-pkg",
		]);
	});

	it("包级清单损坏：跳过该包并打印 warn，不影响其余包", async () => {
		const root = await makeFixture();
		const warnings: unknown[][] = [];
		const original = console.warn;
		console.warn = (...args: unknown[]) => {
			warnings.push(args);
		};
		let aliases: Record<string, string>;
		try {
			aliases = await collectWorkspaceAliases(root);
		} finally {
			console.warn = original;
		}

		expect(aliases["@t/broken-pkg"]).toBeUndefined();
		expect(aliases["@t/lib-pkg"]).toBeDefined();
		expect(warnings).toHaveLength(1);
		expect(String(warnings[0]![0])).toContain(
			"pkgs/broken-pkg",
		);
	});

	it("仓库根无 package.json：空表即正确语义（下游安装形态）", async () => {
		const root = join(
			tmpdir(),
			`console-builder-alias-empty-${Date.now()}`,
		);
		cleanup = root;
		await mkdir(root, { recursive: true });
		const aliases = await collectWorkspaceAliases(root);
		expect(aliases).toEqual({});
	});

	it("仓库根清单损坏：打印 error 后降级为空表，不抛出", async () => {
		const root = await makeFixture(true);
		const errors: unknown[][] = [];
		const original = console.error;
		console.error = (...args: unknown[]) => {
			errors.push(args);
		};
		let aliases: Record<string, string>;
		try {
			aliases = await collectWorkspaceAliases(root);
		} finally {
			console.error = original;
		}

		expect(aliases).toEqual({});
		expect(errors).toHaveLength(1);
		expect(String(errors[0]![0])).toContain(
			"package.json 解析失败",
		);
	});
});
