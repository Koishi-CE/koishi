// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 上游巡检工具（零依赖，bun 直跑）。
 *
 * 用法：
 *   bun tooling/upstream-audit/index.ts               刷新上游缓存并输出目录对比底稿
 *   bun tooling/upstream-audit/index.ts --no-refresh  只对比不联网（缓存已有内容）
 *   bun tooling/upstream-audit/index.ts --only webui  只处理名称匹配（子串）的上游
 *   bun tooling/upstream-audit/index.ts --out <file>  底稿写入文件而不打印 stdout
 *
 * 上游源码一律克隆到仓库之外的缓存目录（默认本仓 ../cache/upstream，
 * 可用环境变量 KOISHI_CE_UPSTREAM_CACHE 改写），避免污染工作区。
 *
 * 产出是一份 markdown「底稿」：每个映射目录给出仅一侧存在的文件、
 * 共同文件经 `git diff --no-index -w`（压制缩进 / 空白噪音）的改动量
 * 排行。语义判断（是不是该 port、是否本仓刻意分叉）仍由人工完成，
 * 流程与判定标准见 docs/process/upstream.md 的 Routine inspection 节。
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compareMapping, expandGlob } from "./compare.ts";
import type { Mapping, Upstream } from "./config.ts";
import { CACHE, ROOT, UPSTREAMS } from "./config.ts";
import { run } from "./git.ts";
import type {
	MappingEntry,
	UpstreamSection,
} from "./report.ts";
import { renderReport } from "./report.ts";

interface Options {
	noRefresh: boolean;
	only?: string | undefined;
	out?: string | undefined;
}

function parseArgs(argv: string[]): Options {
	const options: Options = { noRefresh: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--no-refresh") options.noRefresh = true;
		else if (arg === "--only") options.only = argv[++i];
		else if (arg === "--out") options.out = argv[++i];
	}
	return options;
}

/** 刷新（或补克隆）单个上游缓存，返回底稿状态行。 */
function refreshCache(dir: string, url: string): string {
	if (!existsSync(dir)) {
		const { code } = run("git", [
			"clone",
			"--quiet",
			"--depth",
			"1",
			url,
			dir,
		]);
		return code === 0
			? "缓存：新克隆。"
			: "缓存：克隆失败（网络？），本次跳过。";
	}
	const { code } = run(
		"git",
		["pull", "--quiet", "--ff-only"],
		dir,
	);
	return code === 0
		? "缓存：已刷新。"
		: "缓存：刷新失败（本地有改动或离线），沿用现有内容。";
}

/** 把单条映射构造成底稿条目（含存在性检查与内容对比）。 */
function buildEntry(
	mapping: Mapping,
	dir: string,
): MappingEntry {
	const meta = {
		up: mapping.up,
		ours: mapping.ours,
		note: mapping.note,
	};
	if (mapping.skipDiff) return { kind: "skip", ...meta };
	if (mapping.glob) {
		const base = mapping.up.replace(/\/\*$/, "");
		if (!existsSync(join(dir, base))) {
			return {
				kind: "glob",
				...meta,
				base,
				baseMissing: true,
				subs: [],
				unmatched: [],
			};
		}
		const { matched, unmatched } = expandGlob(
			dir,
			ROOT,
			mapping,
		);
		const subs = matched.map(({ up, ours }) => ({
			up,
			ours,
			stats: compareMapping(
				join(dir, up),
				join(ROOT, ours),
			),
		}));
		return { kind: "glob", ...meta, base, subs, unmatched };
	}
	const upstreamDir =
		mapping.up === "." ? dir : join(dir, mapping.up);
	if (!existsSync(upstreamDir))
		return { kind: "missingUp", ...meta };
	if (!existsSync(join(ROOT, mapping.ours)))
		return { kind: "missingOurs", ...meta };
	return {
		kind: "stats",
		...meta,
		stats: compareMapping(
			upstreamDir,
			join(ROOT, mapping.ours),
		),
	};
}

/** 刷新缓存并构造单个上游的底稿区块。 */
function buildSection(
	upstream: Upstream,
	options: Options,
): UpstreamSection {
	const dir = join(CACHE, upstream.name);
	const section: UpstreamSection = {
		upstream,
		mappings: [],
	};
	if (!options.noRefresh)
		section.cacheStatus = refreshCache(dir, upstream.url);
	if (!existsSync(dir)) {
		section.cacheMissing = true;
		return section;
	}
	section.head = run(
		"git",
		["log", "-1", "--format=%h %ad %s", "--date=short"],
		dir,
	).out.trim();
	section.mappings = upstream.mappings.map((m) =>
		buildEntry(m, dir),
	);
	return section;
}

// ---------------------------------------------------------------- 主流程

const options = parseArgs(process.argv.slice(2));
const sections = UPSTREAMS.filter(
	(u) => !options.only || u.name.includes(options.only),
).map((u) => buildSection(u, options));
const report = renderReport(
	sections,
	CACHE,
	new Date().toISOString().slice(0, 10),
).join("\n");

if (options.out) writeFileSync(options.out, `${report}\n`);
else console.log(report);
