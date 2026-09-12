// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { afterEach, describe, expect, it } from "bun:test";
/**
 * 依赖图分析层单元测试：往 Bun 的进程级 require.cache 种入假模块
 * 图（分析算法只消费 children 项的 filename，不真正 require），
 * 钉死 accepted / declined 的传播、declined 判定与循环依赖兜底。
 * isInNodeModules 的路径判定由 watcher.test.ts 覆盖，此处不重复。
 */
import {
	analyzeChanges,
	loadDependencies,
} from "./analyze.ts";

/** 本用例种入 require.cache 的假路径（afterEach 逐一清除） */
const seeded: string[] = [];

/**
 * 种入一个假模块：children 以路径数组声明，引用 cache 中的实体
 * （子模块须先种；loadDependencies 沿 children 项直接递归，骨架
 * children 会断传递链，与真实模块的共享引用形态不符）。
 */
function seed(filename: string, children: string[] = []) {
	seeded.push(filename, ...children);
	require.cache[filename] = {
		filename,
		children: children.map(
			(child) =>
				require.cache[child] ?? {
					filename: child,
					children: [],
				},
		),
	} as unknown as NodeJS.Module;
}

afterEach(() => {
	for (const filename of seeded.splice(0)) {
		delete require.cache[filename];
	}
});

describe("analyzeChanges 依赖图分析", () => {
	it("初值：stashed 全量 accepted，externals 全量 declined", () => {
		seed("/proj/src/changed.ts");
		seed("/proj/external.ts");
		const { accepted, declined } = analyzeChanges(
			new Set(["/proj/src/changed.ts"]),
			new Set(["/proj/external.ts"]),
		);
		expect([...accepted]).toEqual(["/proj/src/changed.ts"]);
		expect([...declined]).toEqual(["/proj/external.ts"]);
	});

	it("传播：夹在两个变动文件之间的中间模块 accepted", () => {
		// a、b 同批变动（防抖窗口累积）；a require util、util require b，
		// util 的依赖含变动文件 b → util accepted。消费端据此可把
		// 「只依赖 util 的插件」也判为需要重载
		seed("/proj/src/a.ts", ["/proj/src/util.ts"]);
		seed("/proj/src/util.ts", ["/proj/src/b.ts"]);
		seed("/proj/src/b.ts");
		const { accepted } = analyzeChanges(
			new Set(["/proj/src/a.ts", "/proj/src/b.ts"]),
			new Set(),
		);
		expect([...accepted].sort()).toEqual([
			"/proj/src/a.ts",
			"/proj/src/b.ts",
			"/proj/src/util.ts",
		]);
	});

	it("不依赖变动文件的依赖链整体 declined", () => {
		// changed 变动且 require x、x require y：x、y 处于变动文件的
		// 下游（不依赖变动本身），先 y 后 x 逐层 declined
		seed("/proj/src/changed.ts", ["/proj/src/x.ts"]);
		seed("/proj/src/x.ts", ["/proj/src/y.ts"]);
		seed("/proj/src/y.ts");
		const { accepted, declined } = analyzeChanges(
			new Set(["/proj/src/changed.ts"]),
			new Set(),
		);
		expect([...accepted]).toEqual(["/proj/src/changed.ts"]);
		expect(
			declined.has("/proj/src/x.ts") &&
				declined.has("/proj/src/y.ts"),
		).toBe(true);
	});

	it("node_modules 与 externals 的模块不参与分析", () => {
		seed("/proj/src/changed.ts", [
			"/proj/node_modules/pkg/index.js",
			"/proj/external.ts",
		]);
		seed("/proj/node_modules/pkg/index.js");
		seed("/proj/external.ts");
		const { accepted, declined } = analyzeChanges(
			new Set(["/proj/src/changed.ts"]),
			new Set(["/proj/external.ts"]),
		);
		// 两者既不进 pending，也不落入任一结果集合
		expect([...accepted]).toEqual(["/proj/src/changed.ts"]);
		expect([...declined]).toEqual(["/proj/external.ts"]);
	});

	it("循环依赖兜底为 declined", () => {
		// changed require p、p 与 q 互相 require：p、q 均无法定论，
		// 不动点循环无进展退出后，残留 pending 一律 declined
		seed("/proj/src/changed.ts", ["/proj/src/p.ts"]);
		seed("/proj/src/p.ts", ["/proj/src/q.ts"]);
		seed("/proj/src/q.ts", ["/proj/src/p.ts"]);
		const { declined } = analyzeChanges(
			new Set(["/proj/src/changed.ts"]),
			new Set(),
		);
		expect(
			declined.has("/proj/src/p.ts") &&
				declined.has("/proj/src/q.ts"),
		).toBe(true);
	});
});

describe("loadDependencies 依赖收集", () => {
	it("收集入口及全部传递依赖，排除 ignored 与 node_modules", () => {
		seed("/proj/src/leaf.ts");
		seed("/proj/src/util.ts", ["/proj/src/leaf.ts"]);
		seed("/proj/src/skip.ts");
		seed("/proj/node_modules/pkg/index.js");
		seed("/proj/src/entry.ts", [
			"/proj/src/util.ts",
			"/proj/src/skip.ts",
			"/proj/node_modules/pkg/index.js",
		]);
		const dependencies = loadDependencies(
			"/proj/src/entry.ts",
			new Set(["/proj/src/skip.ts"]),
		);
		expect([...dependencies].sort()).toEqual([
			"/proj/src/entry.ts",
			"/proj/src/leaf.ts",
			"/proj/src/util.ts",
		]);
	});

	it("入口不在 require.cache 时返回空集合", () => {
		expect(
			loadDependencies("/proj/src/absent.ts", new Set()),
		).toEqual(new Set());
	});
});
