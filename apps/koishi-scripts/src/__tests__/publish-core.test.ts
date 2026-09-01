// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	discoverPackages,
	isDowngrade,
	planPublish,
	rewriteWorkspaceProtocol,
	topoSort,
	type WorkspacePkg,
} from "../release/publish-core.ts";

/** 快速构造 WorkspacePkg。 */
function pkg(name: string, deps: Record<string, string> = {}): WorkspacePkg {
	return {
		name,
		dir: join("/tmp", name),
		version: "1.0.0",
		dependencies: deps,
	};
}

/** 在临时目录里造一个可发现的工作区（external/ 单包 + monorepo 私有根 + 子包）。 */
function withTempWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "koishi-scripts-test-"));
	mkdirSync(join(root, "external", "single"), { recursive: true });
	writeFileSync(
		join(root, "external", "single", "package.json"),
		JSON.stringify({ name: "koishi-plugin-single", version: "0.1.0" }),
	);
	mkdirSync(join(root, "external", "mono", "packages", "sub"), {
		recursive: true,
	});
	writeFileSync(
		join(root, "external", "mono", "package.json"),
		JSON.stringify({ name: "@root/mono", private: true }),
	);
	writeFileSync(
		join(root, "external", "mono", "packages", "sub", "package.json"),
		JSON.stringify({
			name: "koishi-plugin-sub",
			version: "0.2.0",
			dependencies: { "koishi-plugin-single": "workspace:*" },
		}),
	);
	mkdirSync(join(root, "external", "nopkg"));
	return root;
}

describe("discoverPackages", () => {
	it("发现单包与 monorepo 子包，过滤 private 根与无清单目录", async () => {
		const root = withTempWorkspace();
		try {
			const pkgs = await discoverPackages(root);
			expect(pkgs.map((p) => p.name).sort()).toEqual([
				"koishi-plugin-single",
				"koishi-plugin-sub",
			]);
			const sub = pkgs.find((p) => p.name === "koishi-plugin-sub");
			expect(sub?.dependencies["koishi-plugin-single"]).toBe("workspace:*");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("planPublish", () => {
	it("版本已在 registry → 跳过；首次发布 → 全部待发", () => {
		const a = pkg("a");
		const b = pkg("b");
		const published = new Map<string, Set<string>>([
			["a", new Set(["1.0.0"])],
			["b", new Set<string>()],
		]);
		const plan = planPublish([a, b], published);
		expect(plan.toPublish).toEqual([b]);
		expect(plan.skipped).toEqual([
			{ pkg: a, reason: "版本 1.0.0 已在 registry" },
		]);
	});

	it("缺少 registry 信息 → 抛错", () => {
		expect(() => planPublish([pkg("a")], new Map())).toThrow(
			"registry 版本信息",
		);
	});
});

describe("topoSort", () => {
	it("被依赖者在前", () => {
		const a = pkg("a");
		const b = pkg("b", { a: "^1.0.0" });
		const c = pkg("c", { b: "^1.0.0", a: "^1.0.0" });
		expect(topoSort([c, b, a]).map((p) => p.name)).toEqual(["a", "b", "c"]);
	});

	it("依赖环 → 抛错", () => {
		const a = pkg("a", { b: "^1.0.0" });
		const b = pkg("b", { a: "^1.0.0" });
		expect(() => topoSort([a, b])).toThrow("存在环");
	});
});

describe("isDowngrade", () => {
	it("本地版本低于已发布任一版本 → true", () => {
		expect(isDowngrade("1.0.0", new Set(["1.0.1"]))).toBe(true);
		expect(isDowngrade("1.0.0", new Set(["0.9.0", "2.0.0"]))).toBe(true);
	});

	it("同版本或更高 → false", () => {
		expect(isDowngrade("1.0.0", new Set(["1.0.0"]))).toBe(false);
		expect(isDowngrade("1.1.0", new Set(["1.0.0"]))).toBe(false);
	});

	it("预发布后缀不参与比较", () => {
		expect(isDowngrade("1.2.3", new Set(["1.2.3-beta.1"]))).toBe(false);
	});
});

describe("rewriteWorkspaceProtocol", () => {
	it("改写 workspace:* 为 caret 真实版本并记录变更", () => {
		const raw = `${JSON.stringify({
			name: "c",
			dependencies: { a: "workspace:*", lodash: "^4.0.0" },
			peerDependencies: { b: "workspace:*" },
		})}\n`;
		const versions = new Map([
			["a", "1.2.3"],
			["b", "0.1.0"],
		]);
		const { text, changes } = rewriteWorkspaceProtocol(raw, versions);
		const rewritten = JSON.parse(text) as {
			dependencies?: Record<string, string>;
			peerDependencies?: Record<string, string>;
		};
		expect(rewritten.dependencies?.["a"]).toBe("^1.2.3");
		expect(rewritten.dependencies?.["lodash"]).toBe("^4.0.0");
		expect(rewritten.peerDependencies?.["b"]).toBe("^0.1.0");
		expect(changes).toEqual([
			{ field: "dependencies", dep: "a", range: "^1.2.3" },
			{ field: "peerDependencies", dep: "b", range: "^0.1.0" },
		]);
	});

	it("无 workspace:* 时原样返回", () => {
		const raw = `${JSON.stringify({ name: "c", dependencies: { a: "^1.0.0" } })}\n`;
		const { text, changes } = rewriteWorkspaceProtocol(
			raw,
			new Map([["a", "1.0.0"]]),
		);
		expect(text).toBe(raw);
		expect(changes).toEqual([]);
	});

	it("工作区找不到依赖版本 → 抛错", () => {
		const raw = `${JSON.stringify({ name: "c", dependencies: { ghost: "workspace:*" } })}\n`;
		expect(() => rewriteWorkspaceProtocol(raw, new Map())).toThrow("ghost");
	});
});
