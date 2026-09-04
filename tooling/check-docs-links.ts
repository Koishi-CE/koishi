// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 文档相对链接存活检查（零依赖，bun 直跑）。
 *
 * 用法：bun tooling/check-docs-links.ts
 *
 * 扫描 docs/ 全部 markdown，以及根部 README.md / NOTICE / AGENTS.md 与
 * .github/ 下的 markdown，校验两件事：
 *   1. 相对链接（含图片与引用式链接）指向的文件 / 目录是否存在；
 *   2. 链接锚点（#fragment）能否在目标文件（或本文件）的标题中找到
 *      对应的 GitHub 风格 slug。
 * 外链（http:// / https:// / mailto:）不校验；代码围栏与行内代码中的
 * 内容整体跳过，避免示例链接误报。发现任何问题时退出码置 1。
 */
import {
	existsSync,
	readdirSync,
	readFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

/** 仓库根目录（本脚本位于 tooling/ 下）。 */
const ROOT = resolve(import.meta.dirname, "..");

/** 递归收集目录下全部 .md 文件（跳过 node_modules）。 */
function collectMarkdown(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, {
		withFileTypes: true,
	})) {
		if (entry.name === "node_modules") continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...collectMarkdown(full));
		} else if (entry.name.endsWith(".md")) {
			out.push(full);
		}
	}
	return out;
}

/** 待检查文件清单：docs 全树 + 根部门面文件 + .github 文档。 */
const FILES: string[] = [
	...collectMarkdown(join(ROOT, "docs")),
	join(ROOT, "README.md"),
	join(ROOT, "NOTICE"),
	join(ROOT, "AGENTS.md"),
	...collectMarkdown(join(ROOT, ".github")),
].filter((file) => existsSync(file));

/**
 * 生成标题的 GitHub 风格锚点 slug：转小写、删除标点（保留字母数字
 * （含中日韩）、下划线、连字符与空白）、连续空白折叠为单个连字符。
 */
function githubSlug(heading: string): string {
	return heading
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s_-]/gu, "")
		.replace(/\s+/g, "-");
}

/**
 * 提取 markdown 文件内全部可用锚点（围栏外）：各标题的 GitHub 风格 slug
 * 加上 HTML 显式锚点（<a id="...">）；忽略不存在的文件。
 */
function anchorSlugs(file: string): Set<string> {
	const slugs = new Set<string>();
	if (!existsSync(file)) return slugs;
	let inFence = false;
	for (const line of readFileSync(file, "utf8").split(
		/\r?\n/,
	)) {
		if (line.trimStart().startsWith("```")) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
		if (heading) {
			slugs.add(githubSlug(heading[2] ?? ""));
			continue;
		}
		for (const anchor of line.matchAll(
			/<a\s+id="([^"]+)"/g,
		)) {
			slugs.add(anchor[1] ?? "");
		}
	}
	return slugs;
}

/**
 * 链接相对路径的解析基准目录。GitHub 对 .github 顶层的社区健康文件
 * （CONTRIBUTING / SECURITY / CODE_OF_CONDUCT 等）按仓库根解析相对链接，
 * 其余文件按所在目录解析。
 */
function linkBaseDir(file: string): string {
	const rel = file
		.slice(ROOT.length + 1)
		.replaceAll("\\", "/");
	return /^\.github[/\\][^/\\]+\.md$/.test(rel)
		? ROOT
		: dirname(file);
}

/** 单条链接问题。 */
type LinkIssue = {
	/** 相对仓库根的文件路径。 */
	file: string;
	/** 行号（从 1 计）。 */
	line: number;
	/** 问题描述。 */
	message: string;
};

/**
 * 校验单个链接目标。target 为链接括号或引用式冒号后的原始字符串；
 * 返回 null 表示通过，否则返回问题描述。
 */
function checkTarget(
	target: string,
	fromFile: string,
): string | null {
	if (/^(https?:|mailto:)/i.test(target)) return null;
	const hashIndex = target.indexOf("#");
	const pathPart =
		hashIndex === -1 ? target : target.slice(0, hashIndex);
	const anchor =
		hashIndex === -1 ? "" : target.slice(hashIndex + 1);
	// 纯锚点：目标就是当前文件；否则解析相对路径（URL 解码后拼接）。
	let destFile = fromFile;
	if (pathPart !== "") {
		let decoded: string;
		try {
			decoded = decodeURIComponent(pathPart);
		} catch {
			return `链接路径无法 URL 解码：${target}`;
		}
		destFile = resolve(linkBaseDir(fromFile), decoded);
		if (!existsSync(destFile))
			return `链接目标不存在：${decoded}`;
	}
	if (anchor === "") return null;
	if (!destFile.endsWith(".md")) return null;
	const slug = anchor.toLowerCase();
	if (!anchorSlugs(destFile).has(slug)) {
		const where =
			destFile === fromFile ? "本文件" : "目标文件";
		return `锚点 #${anchor} 在${where}的标题中不存在`;
	}
	return null;
}

/** 校验单个 markdown 文件，返回问题列表。 */
function checkFile(file: string): LinkIssue[] {
	const issues: LinkIssue[] = [];
	const relFile = file
		.replaceAll("\\", "/")
		.slice(ROOT.length + 1);
	const lines = readFileSync(file, "utf8").split(/\r?\n/);
	let inFence = false;
	lines.forEach((rawLine, index) => {
		const lineNo = index + 1;
		if (rawLine.trimStart().startsWith("```")) {
			inFence = !inFence;
			return;
		}
		if (inFence) return;
		// 剔除行内代码段，避免示例文本中的方括号被当作链接。
		const line = rawLine.replace(/`[^`]*`/g, "");
		// 行内链接与图片：[text](target)，target 不含空白与括号。
		for (const match of line.matchAll(
			/!?\[[^\]]*\]\(([^)\s]+)\)/g,
		)) {
			const target = match[1] ?? "";
			const problem = checkTarget(target, file);
			if (problem)
				issues.push({
					file: relFile,
					line: lineNo,
					message: problem,
				});
		}
		// 引用式链接定义：[label]: target（target 取首个空白前的片段）。
		for (const match of line.matchAll(
			/^\s{0,3}\[[^\]]+\]:\s*(\S+)/g,
		)) {
			const target = match[1] ?? "";
			const problem = checkTarget(target, file);
			if (problem)
				issues.push({
					file: relFile,
					line: lineNo,
					message: problem,
				});
		}
	});
	return issues;
}

// ---- 主流程 ----

const allIssues: LinkIssue[] = [];
for (const file of FILES) {
	allIssues.push(...checkFile(file));
}

if (allIssues.length === 0) {
	console.log(
		`文档链接检查通过（${FILES.length} 个文件）。`,
	);
} else {
	for (const issue of allIssues) {
		console.error(
			`${issue.file}:${issue.line}: ${issue.message}`,
		);
	}
	console.error(
		`文档链接检查失败：${allIssues.length} 处问题。`,
	);
	process.exitCode = 1;
}
