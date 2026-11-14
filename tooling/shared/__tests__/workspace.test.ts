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
import {
	discoverWorkspaceDirs,
	readCatalogSpecs,
	readWorkspaceGlobs,
} from "../workspace.ts";

/** 在临时目录写一个最小 package.json。 */
function writePackage(
	dir: string,
	manifest: Record<string, unknown>,
) {
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify(manifest),
	);
}

test("readWorkspaceGlobs：数组形态与对象形态（Bun catalog 协议）都解析", () => {
	const root = mkdtempSync(
		join(tmpdir(), "shared-ws-test-"),
	);
	try {
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({ workspaces: ["a/*"] }),
		);
		expect(readWorkspaceGlobs(root)).toEqual(["a/*"]);
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({
				workspaces: {
					packages: ["a/*", "b/*"],
					catalog: { x: "^1.0.0" },
				},
			}),
		);
		expect(readWorkspaceGlobs(root)).toEqual([
			"a/*",
			"b/*",
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("discoverWorkspaceDirs：单层 glob 用文件系统枚举，跳过无 manifest 的目录由消费方过滤", () => {
	const root = mkdtempSync(
		join(tmpdir(), "shared-ws-test-"),
	);
	try {
		writePackage(join(root, "pkgs/one"), {
			name: "@t/one",
		});
		mkdirSync(join(root, "pkgs/nopkg"), {
			recursive: true,
		});
		writeFileSync(join(root, "pkgs/loose.txt"), "");
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({ workspaces: ["pkgs/*"] }),
		);
		const dirs = discoverWorkspaceDirs(root);
		const names = dirs.map((dir) =>
			dir.replaceAll("\\", "/").split("/").pop(),
		);
		// 只返回目录（文件与单层 glob 无关），去重且按路径排序；
		// nopkg 是否保留由消费方按 package.json 过滤
		expect(names).toEqual(["nopkg", "one"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("discoverWorkspaceDirs：template 段内的目录不是 workspace 包", () => {
	const root = mkdtempSync(
		join(tmpdir(), "shared-ws-test-"),
	);
	try {
		writePackage(join(root, "pkgs/one"), {
			name: "@t/one",
		});
		// 深层 glob 命中模板目录与普通包
		writePackage(join(root, "apps/x/src/template/sub"), {
			name: "@t/tpl",
		});
		writePackage(join(root, "apps/x/src/real"), {
			name: "@t/real",
		});
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({
				workspaces: ["pkgs/*", "apps/x/src/**"],
			}),
		);
		const names = discoverWorkspaceDirs(root).map((dir) =>
			dir.replaceAll("\\", "/").split("/").slice(-2),
		);
		expect(names).toEqual([
			["src", "real"],
			["pkgs", "one"],
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("readCatalogSpecs：default 与 named 目录，非字符串 spec 忽略", () => {
	const root = mkdtempSync(
		join(tmpdir(), "shared-ws-test-"),
	);
	try {
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({
				workspaces: {
					catalog: { cosmokit: "^1.8.1", bad: 42 },
					catalogs: {
						web: { vue: "^3.5.0" },
					},
				},
			}),
		);
		const specs = readCatalogSpecs(root);
		expect(specs.default.get("cosmokit")).toBe("^1.8.1");
		expect(specs.default.has("bad")).toBe(false);
		expect(specs.named.get("web")?.get("vue")).toBe(
			"^3.5.0",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
