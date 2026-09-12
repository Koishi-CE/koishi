// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 文件收集与排除规则：产物 / 测试在目录对比里只产生噪音，三闸过滤。
 */
import { sep } from "node:path";

/** 汇总排除的目录段。 */
const IGNORE_SEGMENTS = new Set([
	"lib",
	"dist",
	"node_modules",
	"coverage",
	"__tests__",
	"tests",
	".github",
	".git",
]);
const IGNORE_SUFFIXES = [".test.ts", ".spec.ts", ".map"];
const IGNORE_NAMES = new Set([
	"package.json",
	"README.md",
	"CHANGELOG.md",
	".gitignore",
	".npmignore",
	"tsconfig.json",
	"tsconfig.client.json",
]);

/** 按排除规则过滤相对路径（目录段 / 后缀 / 文件名三闸）。 */
function isIgnored(rel: string): boolean {
	const segments = rel.split("/");
	if (
		segments
			.slice(0, -1)
			.some((s) => IGNORE_SEGMENTS.has(s))
	)
		return true;
	if (IGNORE_SUFFIXES.some((s) => rel.endsWith(s)))
		return true;
	const last = segments.at(-1);
	return last !== undefined && IGNORE_NAMES.has(last);
}

/** 收集目录下全部文件（Bun.Glob），返回相对仓库/上游根的 posix 风格路径。 */
export function collectFiles(dir: string): string[] {
	return [
		...new Bun.Glob("**/*").scanSync({
			cwd: dir,
			onlyFiles: true,
		}),
	]
		.map((file) => file.split(sep).join("/"))
		.filter((file) => !isIgnored(file))
		.sort();
}

/**
 * 目录存在性检查：Bun 没有同步 stat 类 API（BunFile.exists 对目录恒 false），
 * 借 Glob 扫描实现——目录缺失时 scanSync 抛 ENOENT，其余（含空目录）视为存在；
 * 权限不足等异常与 node existsSync 口径一致地折算为 false。
 */
export function dirExists(dir: string): boolean {
	try {
		[
			...new Bun.Glob("*").scanSync({
				cwd: dir,
				onlyFiles: false,
			}),
		];
		return true;
	} catch {
		return false;
	}
}
