// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 底稿渲染：把结构化巡检结果拼成 markdown 底稿行。
 */
import type { CompareStats } from "./compare.ts";
import type { Upstream } from "./config.ts";

/** 单条映射在底稿里的呈现形态。 */
export type MappingEntry =
	| {
			kind: "skip";
			up: string;
			ours: string;
			note?: string | undefined;
	  }
	| {
			kind: "missingUp";
			up: string;
			ours: string;
			note?: string | undefined;
	  }
	| {
			kind: "missingOurs";
			up: string;
			ours: string;
			note?: string | undefined;
	  }
	| {
			kind: "stats";
			up: string;
			ours: string;
			note?: string | undefined;
			stats: CompareStats;
	  }
	| {
			kind: "glob";
			up: string;
			ours: string;
			note?: string | undefined;
			/** glob 基路径（去掉 /* 后缀）。 */
			base: string;
			baseMissing?: boolean | undefined;
			subs: {
				up: string;
				ours: string;
				stats: CompareStats;
			}[];
			unmatched: string[];
	  };

/** 单个上游在底稿里的呈现形态。 */
export interface UpstreamSection {
	upstream: Upstream;
	/** 缓存刷新状态行（--no-refresh 时缺省）。 */
	cacheStatus?: string | undefined;
	/** 缓存目录不存在（--no-refresh 且从未克隆，或克隆失败）。 */
	cacheMissing?: boolean | undefined;
	head?: string | undefined;
	mappings: MappingEntry[];
}

/** 渲染一对目录的对比结果（与旧逐文件口径逐字一致）。 */
function renderStats(stats: CompareStats): string[] {
	const lines: string[] = [];
	lines.push(
		`仅上游有 ${stats.onlyUp.length} 个、仅本仓有 ${stats.onlyOurs.length} 个、共同 ${stats.commonCount} 个（均不含已排除的产物与测试）。`,
	);
	for (const f of stats.onlyUp.slice(0, 20))
		lines.push(`  - 上游独有: ${f}`);
	if (stats.onlyUp.length > 20)
		lines.push(`  - ……另有 ${stats.onlyUp.length - 20} 个`);
	for (const f of stats.onlyOurs.slice(0, 20))
		lines.push(`  - 本仓独有: ${f}`);
	if (stats.onlyOurs.length > 20)
		lines.push(
			`  - ……另有 ${stats.onlyOurs.length - 20} 个`,
		);

	if (!stats.churn.length) {
		lines.push("共同文件在 -w 口径下零差异。");
		return lines;
	}
	lines.push(
		`-w 口径下有差异的共同文件 ${stats.churn.length} 个，改动量 Top：`,
	);
	for (const { file, add, del } of stats.churn.slice(
		0,
		15,
	)) {
		lines.push(`  - ${file}  +${add} / -${del}`);
	}
	if (stats.churn.length > 15)
		lines.push(`  - ……另有 ${stats.churn.length - 15} 个`);
	return lines;
}

/** 渲染单条映射（glob 映射含子映射与无对应名单）。 */
function renderEntry(entry: MappingEntry): string[] {
	if (entry.kind === "skip")
		return [
			"vendored 预编译产物，不做内容对比；重打包时人工核上游 changelog。",
		];
	if (entry.kind === "missingUp")
		return [
			"上游目录已不存在（可能被删除 / 改名），单独核实。",
		];
	if (entry.kind === "missingOurs")
		return ["本仓目录缺失，单独核实。"];
	if (entry.kind === "stats")
		return renderStats(entry.stats);
	const lines: string[] = [];
	if (entry.baseMissing) {
		lines.push(
			"上游目录已不存在（可能被删除 / 改名），单独核实。",
		);
		return lines;
	}
	for (const sub of entry.subs) {
		lines.push("");
		lines.push(`#### ${sub.up} → ${sub.ours}`);
		lines.push(...renderStats(sub.stats));
	}
	// glob 配不上对的子目录是独立信号：上游可能新增 / 改名了插件
	for (const up of entry.unmatched)
		lines.push(`- 上游子目录无本仓对应：${up}`);
	return lines;
}

/** 渲染单个上游区块。 */
function renderSection(section: UpstreamSection): string[] {
	const lines: string[] = [];
	lines.push(
		`## ${section.upstream.name} — ${section.upstream.url}`,
	);
	lines.push(`基线：${section.upstream.baseline}`);
	if (section.cacheStatus) lines.push(section.cacheStatus);
	if (section.cacheMissing) {
		lines.push("缓存不存在，跳过。", "");
		return lines;
	}
	if (section.head) lines.push(`HEAD：${section.head}`);
	if (!section.upstream.mappings.length) {
		lines.push("（无目录映射，仅跟踪仓库动态。）", "");
		return lines;
	}
	for (const entry of section.mappings) {
		lines.push("");
		lines.push(
			`### ${entry.up} → ${entry.ours}${entry.note ? `（${entry.note}）` : ""}`,
		);
		lines.push(...renderEntry(entry));
	}
	lines.push("");
	return lines;
}

/** 渲染整份底稿。 */
export function renderReport(
	sections: UpstreamSection[],
	cacheDir: string,
	date: string,
): string[] {
	const lines: string[] = [
		`# 上游巡检底稿（${date} 生成）`,
		"",
		`缓存目录：${cacheDir}（仓库外，不入 git）`,
		"",
		"> 这是脚本自动产出的原始对比，用于人工 triage；结论性报告见 docs/process/upstream.md。",
		"",
	];
	for (const section of sections)
		lines.push(...renderSection(section));
	return lines;
}
