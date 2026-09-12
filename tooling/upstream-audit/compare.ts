// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 目录对比逻辑：产出结构化结果，markdown 渲染交给 report.ts。
 */
import { join } from "node:path";
import type { Mapping } from "./config.ts";
import { numstatChurn } from "./git.ts";
import { collectFiles, dirExists } from "./scan.ts";

/** 一对目录的内容对比结果。 */
export interface CompareStats {
	onlyUp: string[];
	onlyOurs: string[];
	commonCount: number;
	churn: { file: string; add: number; del: number }[];
}

/** 对比一对目录。 */
export function compareMapping(
	upstreamDir: string,
	oursDir: string,
): CompareStats {
	const upFiles = collectFiles(upstreamDir);
	const oursFiles = collectFiles(oursDir);
	const upSet = new Set(upFiles);
	const oursSet = new Set(oursFiles);
	const onlyUp = upFiles.filter((f) => !oursSet.has(f));
	const onlyOurs = oursFiles.filter((f) => !upSet.has(f));
	const common = upFiles.filter((f) => oursSet.has(f));

	// 共同文件按真实改动量排序（-w 压掉缩进噪音后仍大的才值得人工看）
	const churnMap = numstatChurn(
		oursDir,
		upstreamDir,
		common,
	);
	const churn: {
		file: string;
		add: number;
		del: number;
	}[] = [];
	for (const file of common) {
		const counts = churnMap.get(file);
		if (!counts || (!counts[0] && !counts[1])) continue;
		churn.push({ file, add: counts[0], del: counts[1] });
	}
	churn.sort((a, b) => b.add + b.del - (a.add + a.del));
	return {
		onlyUp,
		onlyOurs,
		commonCount: common.length,
		churn,
	};
}

/**
 * glob 映射展开：按上游子目录逐个配对本仓同名目录，并给出无对应的子目录。
 * 条目含文件（与原 glob "*" 口径一致），补排序保证底稿顺序确定。
 */
export function expandGlob(
	repoRoot: string,
	oursRoot: string,
	mapping: Mapping,
): {
	matched: { up: string; ours: string }[];
	unmatched: string[];
} {
	const base = mapping.up.replace(/\/\*$/, "");
	// 单层 Glob 等价 readdirSync 口径：文件与目录都列，仅排除点开头条目
	const entries = [
		...new Bun.Glob("*").scanSync({
			cwd: join(repoRoot, base),
			onlyFiles: false,
		}),
	]
		.filter((name) => !name.startsWith("."))
		.sort();
	const matched: { up: string; ours: string }[] = [];
	const unmatched: string[] = [];
	for (const name of entries) {
		const up = `${base}/${name}`;
		const ours = mapping.ours.replace(/\*$/, name);
		if (dirExists(join(oursRoot, ours)))
			matched.push({ up, ours });
		else unmatched.push(up);
	}
	return { matched, unmatched };
}
