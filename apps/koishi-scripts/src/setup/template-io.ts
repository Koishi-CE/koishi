// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * setup 的模板文件 IO：定位内置模板目录、读取模板原文、`@@KEY@@` 占位
 * 渲染与许可证持有人提取。模板静态文本一律放 src/template/ 下的真实
 * 文件（shared/ 单包与 monorepo 共用、single/ 单包专属、monorepo/ 集合
 * 仓库根专属），本模块不做任何写盘。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 定位内置模板目录，两种运行形态各按相对路径探测：
 * - src 直跑（开发 / 测试）：本模块位于 src/setup/ 下，../template
 *   即 src/template；
 * - lib 产物（npm 消费）：tsdown 平铺输出，本模块位于 lib/ 下，
 *   ../src/template 即发布包内随 files 携带的模板源（files 含 src）。
 */
function locateTemplateDir(): string {
	const base = import.meta.dir;
	for (const dir of [
		join(base, "../template"),
		join(base, "../src/template"),
	]) {
		if (existsSync(dir)) return dir;
	}
	throw new Error(
		"koishi-scripts 内置模板目录缺失（src/template）",
	);
}

const templateDir = locateTemplateDir();

/** 读取模板文件原文（相对模板目录的多段路径）。 */
export function readTemplate(
	...segments: string[]
): string {
	return readFileSync(
		join(templateDir, ...segments),
		"utf8",
	);
}

/**
 * 渲染模板：把 `@@KEY@@` 占位替换为给定值，未提供的占位原样保留
 * （写盘后的测试会断言产物不含 @@ 残留）。
 */
export function renderTemplate(
	source: string,
	tokens: Record<string, string>,
): string {
	return source.replace(
		/@@([A-Z_]+)@@/g,
		(raw, key: string) =>
			Object.hasOwn(tokens, key)
				? (tokens[key] ?? raw)
				: raw,
	);
}

/**
 * 从 git 署名行提取许可证持有人名。截断而非剥离 <...> 段——后者对嵌套
 * 尖括号（如 `<<<>script>`）存在清洗绕过，会残留 `<script>` 标签
 * （CodeQL incomplete-multi-character-sanitization）。
 */
export function licenseHolder(author: string): string {
	return (
		(author.split("<")[0] ?? "").trim() || "（作者名）"
	);
}
