// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

// notes 子命令：生成里程碑 Release 正文骨架（只读）。区间＝上一个
// milestone/* tag → HEAD（无则回退历史 v* tag，再无则首个提交）；版本表只
// 列升版的包（changesets ignore 的 shim 四包除外），条目取各包 CHANGELOG
// 新增 bullet，剔除 Updated dependencies 与纯版本号连带升版噪音。正文写
// stdout、进度写 stderr：CI 以重定向取正文，同流混进度会污染 markdown。
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ROOT } from "../core/options.ts";
import { capture } from "../core/utils.ts";
import { discoverPackages } from "../core/workspace.ts";

/** changeset 条目（归属包 + 正文）。 */
export interface ChangelogEntry {
	package: string;
	text: string;
}

/** 版本变化；before 为 null 表示该包首发。 */
interface VersionBump {
	name: string;
	before: string | null;
	after: string;
}

interface NotesInput {
	tag: string;
	previousTag: string;
	commits: number;
	bumps: readonly VersionBump[];
	entries: readonly ChangelogEntry[];
	pulls: readonly string[];
}

/** 依赖连带升版噪音行（Updated dependencies 块与纯版本号行）。 */
const isNoise = (text: string): boolean =>
	text.startsWith("Updated dependencies") ||
	/^@koishi-ce\/[\w-]+@\d/.test(text);

/** 解析 CHANGELOG diff 新增行：`+++ b/` 切包、`- ` 为条目、缩进续行并入。 */
export function parseChangelogDiff(
	diff: string,
	nameByPath: ReadonlyMap<string, string>,
): ChangelogEntry[] {
	const entries: ChangelogEntry[] = [];
	let current: string | undefined;
	let last: ChangelogEntry | undefined;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++ b/")) {
			current = nameByPath.get(
				line.slice(6).replace(/\/CHANGELOG\.md$/, ""),
			);
			last = undefined;
		} else if (
			current !== undefined &&
			line.startsWith("+")
		) {
			const body = line.slice(1);
			const bullet = /^-\s+(\S.*)$/.exec(body);
			if (bullet !== null) {
				const text = bullet[1]?.trim() ?? "";
				const noise = text === "" || isNoise(text);
				last = noise
					? undefined
					: { package: current, text };
				if (!noise) entries.push(last);
			} else if (last && /^\s{2,}\S/.test(body)) {
				last.text += ` ${body.trim()}`;
			}
		}
	}
	return entries;
}

/** 单条 bullet 的最大展示长度（changeset 正文常数千字，不整段搬）。 */
export const BULLET_LIMIT = 160;

/** 截断超长条目并指向 CHANGELOG（细节仍在原地可查）。 */
export function clipBullet(text: string): string {
	return text.length <= BULLET_LIMIT
		? text
		: `${text.slice(0, BULLET_LIMIT)}…（详见 CHANGELOG）`;
}

/** 跨包重复条目（连带升版写进多个包）只保留一次，单包条目归组。 */
function splitEntries(entries: readonly ChangelogEntry[]): {
	shared: ChangelogEntry[];
	scoped: ChangelogEntry[];
} {
	const counts = new Map<string, number>();
	for (const { text } of entries) {
		counts.set(text, (counts.get(text) ?? 0) + 1);
	}
	const shared: ChangelogEntry[] = [];
	const scoped: ChangelogEntry[] = [];
	const emitted = new Set<string>();
	for (const entry of entries) {
		if ((counts.get(entry.text) ?? 0) > 1) {
			if (!emitted.has(entry.text)) {
				emitted.add(entry.text);
				shared.push(entry);
			}
		} else {
			scoped.push(entry);
		}
	}
	return { shared, scoped };
}

/** 由素材拼出 markdown 骨架。 */
export function formatNotes(input: NotesInput): string {
	const range = (bump: VersionBump): string =>
		bump.before === null
			? `首发 ${bump.after}`
			: `${bump.before} → ${bump.after}`;
	const lines = [
		"<!-- 自动生成的 Release 骨架（bun run release notes）。发布前请按主题改写：",
		"     本仓 Release 发布后不可修改（immutable），正文只能在 draft 阶段调整。 -->",
		"",
		"本仓库是 [koishijs/koishi](https://github.com/koishijs/koishi)（MIT）与 [koishijs/webui](https://github.com/koishijs/webui)（部分 AGPL-3.0）的社区再分发 monorepo，npm 作用域 `@koishi-ce`。tag 分两类：`release/<日期>-<序号>` 标记每次发布，`milestone/<major>.<minor>` 标记 core 的兼容线里程碑。",
		"",
		`里程碑 \`${input.tag}\`：自 \`${input.previousTag}\` 以来 ${input.commits} 个提交，升版的包 ${input.bumps.length} 个。`,
		"",
	];
	if (input.bumps.length === 0) {
		lines.push("本区间没有包升版。");
	} else {
		lines.push("| 包 | 版本 |", "|---|---|");
		for (const bump of input.bumps) {
			lines.push(`| \`${bump.name}\` | ${range(bump)} |`);
		}
	}
	const { shared, scoped } = splitEntries(input.entries);
	const bumpByPackage = new Map(
		input.bumps.map((bump) => [bump.name, bump]),
	);
	if (shared.length > 0) {
		lines.push("", "## 跨包批量变更", "");
		for (const { text } of shared) {
			lines.push(`- ${clipBullet(text)}`);
		}
	}
	if (scoped.length > 0) {
		lines.push("", "## 变更明细");
		const grouped = new Map<string, ChangelogEntry[]>();
		for (const entry of scoped) {
			grouped.set(entry.package, [
				...(grouped.get(entry.package) ?? []),
				entry,
			]);
		}
		for (const [name, list] of grouped) {
			const bump = bumpByPackage.get(name);
			lines.push(
				"",
				`### \`${name}\`${bump === undefined ? "" : `（${range(bump)}）`}`,
			);
			for (const { text } of list) {
				lines.push(`- ${clipBullet(text)}`);
			}
		}
	}
	if (input.pulls.length > 0) {
		lines.push(
			"",
			`<details><summary>区间内合并的 PR（${input.pulls.length} 条，供按主题归并）</summary>`,
			"",
		);
		for (const pull of input.pulls) {
			lines.push(`- ${pull}`);
		}
		lines.push("", "</details>");
	}
	lines.push(
		"",
		"## 安装",
		"",
		"新项目经脚手架生成：`bun create koishi-ce`（内置纯 `@koishi-ce` 模板）。全部包以 `@koishi-ce` 作用域发布于 npm。",
		"",
	);
	return lines.join("\n");
}

/** 从 manifest 文本取 version（畸形 / 缺失 → null）。 */
function readVersion(raw: string): string | null {
	try {
		const { version } = JSON.parse(raw) as {
			version?: unknown;
		};
		return typeof version === "string" ? version : null;
	} catch {
		return null;
	}
}

/** changesets ignore 名单（shim 四包版本冻结，不参与变更集与版本表）。 */
function readIgnoredNames(
	root: string,
): ReadonlySet<string> {
	try {
		const { ignore } = JSON.parse(
			readFileSync(
				join(root, ".changeset", "config.json"),
				"utf8",
			),
		) as { ignore?: unknown };
		return new Set(
			Array.isArray(ignore)
				? ignore.filter(
						(name): name is string =>
							typeof name === "string",
					)
				: [],
		);
	} catch {
		return new Set();
	}
}

/** notes：只读，markdown 写 stdout；tag 名取 core 的 major.minor。 */
export async function cmdNotes(): Promise<number> {
	const pkgs = discoverPackages(ROOT);
	const core = pkgs.find(
		(pkg) => pkg.name === "@koishi-ce/core",
	);
	if (core === undefined) {
		process.stderr.write(
			"[notes] ❌ 工作区内找不到 @koishi-ce/core，无法确定里程碑\n",
		);
		return 1;
	}
	const tag = `milestone/${core.version.split(".").slice(0, 2).join(".")}`;
	const posixDir = (dir: string): string =>
		relative(ROOT, dir).split(sep).join("/");
	// 固定参数命令按空格切分：git 不允许 tag / SHA 含空格，包路径是仓库内
	// 固定名（posixDir 相对 ROOT，与仓库落盘位置无关），均无空格
	const git = (cmd: string): string =>
		capture("git", cmd.split(" "), ROOT) ?? "";
	// 基线：优先上一个里程碑（--exclude 防止在已打 tag 的提交上重跑退化成
	// 空 diff）；没有里程碑回退历史 v*，再无则首个提交
	const previousTag =
		git(
			`describe --tags --abbrev=0 --match milestone/* --match v* --exclude ${tag} HEAD`,
		) || git("rev-list --max-parents=0 HEAD");
	if (previousTag === "") {
		process.stderr.write(
			"[notes] ❌ 找不到基线（既无里程碑 / v* tag，也无提交历史）\n",
		);
		return 1;
	}
	const commits =
		Number.parseInt(
			git(`rev-list --count ${previousTag}..HEAD`),
			10,
		) || 0;
	const ignored = readIgnoredNames(ROOT);
	const bumps: VersionBump[] = [];
	for (const pkg of pkgs) {
		if (ignored.has(pkg.name)) continue;
		const raw = git(
			`show ${previousTag}:${posixDir(pkg.dir)}/package.json`,
		);
		const before = raw === "" ? null : readVersion(raw);
		if (before !== pkg.version) {
			bumps.push({
				name: pkg.name,
				before,
				after: pkg.version,
			});
		}
	}
	const nameByPath = new Map(
		pkgs.map((pkg) => [posixDir(pkg.dir), pkg.name]),
	);
	const entries = parseChangelogDiff(
		git(
			`diff --unified=0 ${previousTag}..HEAD -- */CHANGELOG.md`,
		),
		nameByPath,
	);
	const { shared, scoped } = splitEntries(entries);
	const pulls = git(
		`log --format=%s --reverse ${previousTag}..HEAD`,
	)
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => /\(#\d+\)$/.test(line));
	process.stderr.write(
		`[notes] 🏷 ${tag}：自 ${previousTag} 起 ${commits} 个提交、${bumps.length} 个包升版、${shared.length + scoped.length} 条变更（跨包 ${shared.length}）、${pulls.length} 个 PR\n`,
	);
	process.stdout.write(
		formatNotes({
			tag,
			previousTag,
			commits,
			bumps,
			entries,
			pulls,
		}),
	);
	return 0;
}
