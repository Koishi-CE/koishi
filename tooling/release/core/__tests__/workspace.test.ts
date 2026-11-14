// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PkgInfo } from "../workspace.ts";
import {
	discoverPackages,
	filterDowngrades,
	isDowngrade,
	rewriteWorkspaceProtocol,
	topoSort,
} from "../workspace.ts";

/** 造一个最小 PkgInfo（发布序测试只关心依赖字段）。 */
function pkg(
	name: string,
	fields: {
		dependencies?: Record<string, string>;
		peerDependencies?: Record<string, string>;
		optionalDependencies?: Record<string, string>;
	} = {},
): PkgInfo {
	return {
		name,
		version: "1.0.0",
		dir: `/tmp/${name}`,
		manifestPath: `/tmp/${name}/package.json`,
		dependencies: fields.dependencies ?? {},
		peerDependencies: fields.peerDependencies ?? {},
		optionalDependencies: fields.optionalDependencies ?? {},
		files: [],
	};
}

test("发布序：框架依赖插件、插件 peer 框架（互指）不构成环，依赖方在前", () => {
	// 本仓实况的抽象：@koishi-ce/koishi 依赖 plugin-server，
	// plugin-server 又 peer koishi——peer 纳入排序边曾让发布链
	// 整体中断（"内部依赖存在环"），是本用例锁定的回归点
	const ordered = topoSort([
		pkg("@koishi-ce/koishi", {
			dependencies: {
				"@koishi-ce/plugin-server": "workspace:*",
			},
		}),
		pkg("@koishi-ce/plugin-server", {
			peerDependencies: { "@koishi-ce/koishi": "^1.0.0" },
		}),
	]);
	expect(ordered.map((item) => item.name)).toEqual([
		"@koishi-ce/plugin-server",
		"@koishi-ce/koishi",
	]);
});

test("发布序：纯 peer 边不产生顺序约束，双方均可立即发布", () => {
	const ordered = topoSort([
		pkg("@koishi-ce/plugin-a", {
			peerDependencies: { "@koishi-ce/plugin-b": "^1.0.0" },
		}),
		pkg("@koishi-ce/plugin-b"),
	]);
	expect(ordered).toHaveLength(2);
});

test("发布序：真实依赖成环仍抛错（环检测不因放宽 peer 而失效）", () => {
	expect(() =>
		topoSort([
			pkg("@koishi-ce/plugin-a", {
				dependencies: {
					"@koishi-ce/plugin-b": "workspace:*",
				},
			}),
			pkg("@koishi-ce/plugin-b", {
				dependencies: {
					"@koishi-ce/plugin-a": "workspace:*",
				},
			}),
		]),
	).toThrow("内部依赖存在环");
});

/** 在临时目录写一个最小 manifest。 */
function writePkg(
	dir: string,
	manifest: Record<string, unknown>,
) {
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify(manifest),
	);
}

test("包发现：数组形态 workspaces 枚举可发布包并排除 private", () => {
	const root = mkdtempSync(
		join(tmpdir(), "release-workspace-test-"),
	);
	try {
		writePkg(join(root, "pkgs/one"), {
			name: "@t/one",
			version: "1.0.0",
		});
		writePkg(join(root, "pkgs/hidden"), {
			name: "@t/hidden",
			version: "1.0.0",
			private: true,
		});
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({ workspaces: ["pkgs/*"] }),
		);
		expect(
			discoverPackages(root).map((item) => item.name),
		).toEqual(["@t/one"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("包发现：对象形态 workspaces（Bun catalog 协议形态）同样可枚举", () => {
	const root = mkdtempSync(
		join(tmpdir(), "release-workspace-test-"),
	);
	try {
		writePkg(join(root, "pkgs/one"), {
			name: "@t/one",
			version: "1.0.0",
		});
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({
				workspaces: { packages: ["pkgs/*"] },
			}),
		);
		expect(
			discoverPackages(root).map((item) => item.name),
		).toEqual(["@t/one"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("协议改写：catalog: 与 catalog:<名> 替换为根清单定义，覆盖四个依赖字段", () => {
	const raw = JSON.stringify({
		name: "x",
		version: "1.0.0",
		dependencies: { cosmokit: "catalog:" },
		devDependencies: { jsdom: "catalog:test" },
		optionalDependencies: { semver: "catalog:" },
		peerDependencies: { vue: "catalog:web" },
	});
	const catalogs = {
		default: new Map([
			["cosmokit", "^1.8.1"],
			["semver", "^7.8.6"],
		]),
		named: new Map([
			["test", new Map([["jsdom", "^30.1.3"]])],
			["web", new Map([["vue", "^3.5.45"]])],
		]),
	};
	const { text, changes } = rewriteWorkspaceProtocol(
		raw,
		new Map(),
		catalogs,
	);
	const manifest = JSON.parse(text) as Record<
		string,
		Record<string, string>
	>;
	expect(manifest["dependencies"]!["cosmokit"]).toBe(
		"^1.8.1",
	);
	expect(manifest["devDependencies"]!["jsdom"]).toBe(
		"^30.1.3",
	);
	expect(manifest["optionalDependencies"]!["semver"]).toBe(
		"^7.8.6",
	);
	expect(manifest["peerDependencies"]!["vue"]).toBe(
		"^3.5.45",
	);
	expect(changes).toHaveLength(4);
});

test("协议改写：catalog 键（默认或命名）在根清单缺失时抛错，拒绝发布", () => {
	const missingDefault = JSON.stringify({
		name: "x",
		version: "1.0.0",
		dependencies: { nope: "catalog:" },
	});
	expect(() =>
		rewriteWorkspaceProtocol(missingDefault, new Map(), {
			default: new Map(),
			named: new Map(),
		}),
	).toThrow("根清单 catalog 未定义");
	const missingGroup = JSON.stringify({
		name: "x",
		version: "1.0.0",
		dependencies: { vue: "catalog:web" },
	});
	expect(() =>
		rewriteWorkspaceProtocol(missingGroup, new Map(), {
			default: new Map(),
			named: new Map(),
		}),
	).toThrow("根清单 catalog 未定义");
});

test("协议改写：workspace:* 行为不变（caret 真实版本），与 catalog 改写互不干扰", () => {
	const raw = JSON.stringify({
		name: "x",
		version: "1.0.0",
		dependencies: {
			"@t/core": "workspace:*",
			cosmokit: "catalog:",
		},
	});
	const { text, changes } = rewriteWorkspaceProtocol(
		raw,
		new Map([["@t/core", "1.2.3"]]),
		{
			default: new Map([["cosmokit", "^1.8.1"]]),
			named: new Map(),
		},
	);
	const manifest = JSON.parse(text) as Record<
		string,
		Record<string, string>
	>;
	expect(manifest["dependencies"]!["@t/core"]).toBe(
		"^1.2.3",
	);
	expect(manifest["dependencies"]!["cosmokit"]).toBe(
		"^1.8.1",
	);
	expect(changes).toHaveLength(2);
});

test("降级判定：完整版本序（major/minor/patch 与 prerelease 字典序）", () => {
	// Bun.semver.order 让 prerelease 参与比较（旧数值解析忽略预发布段，
	// 1.2.3-alpha 不被判成降级），prerelease 字典序按数字段比较
	const published = new Set(["1.2.3", "1.2.3-beta.11"]);
	expect(isDowngrade("1.2.2", published)).toBe(true);
	expect(isDowngrade("1.2.3-alpha", published)).toBe(true);
	expect(isDowngrade("1.2.3-beta.2", published)).toBe(true);
	// 对 1.2.3-beta.11 这条线是数字段比较；但 registry 同时存在正式版
	// 1.2.3，semver 规则下任何 1.2.3-beta.* 都小于它 → 仍是降级
	expect(
		isDowngrade(
			"1.2.3-beta.12",
			new Set(["1.2.3-beta.11"]),
		),
	).toBe(false);
	expect(isDowngrade("1.2.3-beta.12", published)).toBe(
		true,
	);
	expect(isDowngrade("1.2.3", published)).toBe(false);
	expect(isDowngrade("1.3.0", published)).toBe(false);
	expect(isDowngrade("1.2.3", new Set())).toBe(false);
	expect(isDowngrade("not-semver", published)).toBe(false);
});

test("降级过滤：downgraded 从 toPublish 剔除，其余保持顺序", () => {
	const a = pkg("@t/a");
	const b = pkg("@t/b");
	const c = pkg("@t/c");
	const plan = {
		toPublish: [a, b, c],
		skipped: [],
	};
	const { toPublish, downgraded } = filterDowngrades(
		plan,
		new Map([
			["@t/b", new Set(["2.0.0"])],
			["@t/a", new Set()],
		]),
	);
	expect(downgraded).toEqual([b]);
	expect(toPublish).toEqual([a, c]);
});
