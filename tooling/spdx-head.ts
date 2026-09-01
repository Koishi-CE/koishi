/**
 * 批量给源文件添加 SPDX 版权头（幂等，已含 SPDX 头则跳过）。
 *
 * 用法：
 *   bun tooling/spdx-head.ts <目录> <版权模式>
 *
 * 版权模式：
 *   upstream  —— 只写上游版权行（上游原样文件）
 *   both      —— 并列上游 + Koishi-CE 两行（本仓重构文件）
 *   ours      —— 只写 Koishi-CE 版权行（本仓原创文件）
 *
 * 支持扩展名：.ts / .mts / .tsx / .js / .mjs / .yml / .yaml / .vue
 * - 代码文件头：`// SPDX-License-Identifier: <LIC>`
 * - yml 文件头：`# SPDX-License-Identifier: <LIC>`
 */
import {
	existsSync,
	lstatSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const UPSTREAM_COPYRIGHT =
	"Copyright (c) 2019-present Shigma and Koishijs contributors.";
const OURS_COPYRIGHT = "Copyright (c) 2026-present Koishi-CE contributors.";

const [targetDir = "", mode = "both", license = "MIT"] = process.argv.slice(2);

const codeExt = new Set([".ts", ".mts", ".tsx", ".js", ".mjs"]);
const hashExt = new Set([".yml", ".yaml"]);

if (!existsSync(targetDir)) {
	console.error(`目录不存在: ${targetDir}`);
	process.exit(1);
}

if (!["upstream", "both", "ours"].includes(mode)) {
	console.error(`未知版权模式: ${mode}（应为 upstream / both / ours）`);
	process.exit(1);
}

const copyrightLines: string[] = [];
if (mode === "upstream" || mode === "both")
	copyrightLines.push(UPSTREAM_COPYRIGHT);
if (mode === "ours" || mode === "both") copyrightLines.push(OURS_COPYRIGHT);

let added = 0;
let skipped = 0;
let total = 0;

function walk(dir: string) {
	const st = lstatSync(dir);
	if (st.isFile()) {
		const ext = dir.slice(dir.lastIndexOf(".")).toLowerCase();
		if (codeExt.has(ext) || hashExt.has(ext)) {
			total++;
			processFile(dir, ext);
		}
		return;
	}
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		const child = lstatSync(full);
		if (child.isSymbolicLink()) continue;
		if (child.isDirectory()) {
			if (["node_modules", "lib", "dist", ".changeset"].includes(name))
				continue;
			walk(full);
		} else {
			const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
			if (!codeExt.has(ext) && !hashExt.has(ext)) continue;
			total++;
			processFile(full, ext);
		}
	}
}

function processFile(file: string, ext: string) {
	const content = readFileSync(file, "utf8");
	if (content.includes("SPDX-License-Identifier")) {
		skipped++;
		return;
	}
	const comment = hashExt.has(ext) ? "#" : "//";
	const header =
		`${comment} SPDX-License-Identifier: ${license}\n` +
		copyrightLines.map((line) => `${comment} ${line}`).join("\n") +
		"\n\n";
	// shebang 必须保持在第一行，头注释插入其后
	const shebangMatch = content.match(/^#!.*\n/);
	if (shebangMatch) {
		writeFileSync(
			file,
			shebangMatch[0] + header + content.slice(shebangMatch[0].length),
		);
	} else {
		writeFileSync(file, header + content);
	}
	added++;
}

walk(resolve(targetDir));
console.log(
	`[spdx-head] ${targetDir} — 添加 ${added} 个，跳过 ${skipped} 个（共 ${total} 个源文件）`,
);
