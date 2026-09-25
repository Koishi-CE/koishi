// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 图标资产迁移脚本：把纯模板的 .vue 图标组件抽取为独立 .svg 文件。
 *
 * 背景：集中式图标资产方案（unplugin-icons 编译期转换）要求图标以
 * .svg 形式存放于各包 assets/icons/ 目录，源码经 `~icons/k/<相对路径>`
 * 虚拟模块导入。第一期迁移 @koishi-ce/components 主库（39 个），第二期
 * 迁移各 webui 插件目录（本脚本设计为通用，直接改参数复用）。
 *
 * 转换规则（机械、无损）：
 * - 文件头的 SPDX/版权注释行原样保留在 svg 文件头部；
 * - <template> 的内部内容（svg 元素及其前后的语义注释）原样平移；
 * - 仅支持「纯 template、单 svg 根」的图标组件，遇 <script> 等
 *   非预期形态立即报错退出，不做启发式兜底。
 *
 * 用法：bun tooling/convert-icons-to-svg.ts <源目录> <目标目录> [--strip <目录名>]
 *   例：bun tooling/convert-icons-to-svg.ts \
 *         packages/web/components/src/icons \
 *         packages/web/components/assets/icons \
 *         --strip svg
 *   --strip 指定的目录段不参与文件名前缀（用于「svg/ 即通用平铺层」
 *   这类无分组语义的目录；其余目录段一律以连字符并入文件名）。
 */

import {
	mkdir,
	readdir,
	readFile,
	writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";

const args = process.argv.slice(2);
const [sourceDir, targetDir] = args;
const stripIndex = args.indexOf("--strip");
const stripDirs = new Set(
	stripIndex >= 0 ? args.slice(stripIndex + 1) : [],
);
if (!sourceDir || !targetDir) {
	console.error(
		"用法：bun tooling/convert-icons-to-svg.ts <源目录> <目标目录>",
	);
	process.exit(1);
}

/** 递归收集 .vue 文件（跳过非图标内容） */
async function collectVueFiles(
	dir: string,
): Promise<string[]> {
	const entries = await readdir(dir, {
		withFileTypes: true,
	});
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectVueFiles(path)));
		} else if (entry.name.endsWith(".vue")) {
			files.push(path);
		}
	}
	return files.sort();
}

/** 提取文件头部的注释行（SPDX/版权头），作为 svg 的许可证头 */
function extractHeaderComment(content: string): string {
	const lines = content.split("\n");
	const header: string[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith("<!--")) {
			header.push(trimmed);
		} else if (trimmed === "") {
			// 注释块之间的空行：头尚未结束则继续收集
			if (header.length) header.push("");
		} else {
			break;
		}
	}
	// 去掉尾部多余空行
	while (header.length && header[header.length - 1] === "")
		header.pop();
	return header.join("\n");
}

/** 把单个 .vue 图标转换为 .svg 内容 */
function convert(content: string, path: string): string {
	if (/<script\b/.test(content)) {
		throw new Error(
			`${path} 含 <script> 块，超出纯模板图标的机械转换范围，须人工处理`,
		);
	}
	const match = content.match(
		/<template>\s*([\s\S]*?)\s*<\/template>/,
	);
	if (!match)
		throw new Error(`${path} 未找到 <template> 块`);
	const body = match[1];
	const svgCount = (body.match(/<svg[\s>]/g) ?? []).length;
	if (svgCount !== 1) {
		throw new Error(
			`${path} 的 template 内 svg 根数量为 ${svgCount}（须恰为 1）`,
		);
	}
	const header = extractHeaderComment(content);
	// .vue 源的缩进基准：template 内 svg 根在 2 空格层、子元素更深一层；
	// capture 已吞掉 svg 行前空白使其顶格，其余行统一剥恰好一层缩进
	// （2 空格或 1 tab），还原 svg 文件自身的缩进层级
	const dedented = body
		.split("\n")
		.map((line) => line.replace(/^ {2}|^\t/, ""))
		.join("\n");
	return header
		? `${header}\n\n${dedented.trimEnd()}\n`
		: `${dedented.trimEnd()}\n`;
}

const vueFiles = await collectVueFiles(sourceDir);
if (!vueFiles.length) {
	console.error(
		`源目录 ${sourceDir} 下未找到 .vue 图标文件`,
	);
	process.exit(1);
}

let converted = 0;
for (const path of vueFiles) {
	const rel = relative(sourceDir, path);
	// unplugin-icons 的虚拟模块语法是严格两段（~icons/<集合>/<图标名>），
	// 不支持子目录路径：目录分组以连字符编码进平铺文件名
	// （activity/home.vue -> activity-home.svg）；--strip 的目录段除外
	const segments = rel
		.replace(/\.vue$/, "")
		.split(/[\\/]+/);
	const flatName = segments
		.filter((seg, i) => !(i === 0 && stripDirs.has(seg)))
		.join("-");
	const target = join(targetDir, `${flatName}.svg`);
	await mkdir(join(target, ".."), { recursive: true });
	const content = await readFile(path, "utf-8");
	await writeFile(target, convert(content, path));
	converted++;
	console.log(
		`转换 ${rel} -> ${relative(process.cwd(), target)}`,
	);
}

console.log(`完成：共转换 ${converted} 个图标`);
