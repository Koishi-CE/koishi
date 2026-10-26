// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * notes 子命令：生成**里程碑** Release 的正文骨架（stdout）。
 *
 * 背景：本仓是 53 条独立版本线的 changesets monorepo，没有「整仓版本」。
 * 早先按 `@koishi-ce/core` 的版本打 `v1.1.8` 这类 tag 是错的——它既把单个
 * 包的版本说成整仓版本，也代表不了同一时期另外 24 批不升 core 的发布。
 * 现在的 tag 分两类：
 *
 * - 批次 tag `release/<日期>-<序号>`：每次发布一个，轻量、无 Release，
 *   只回答「npm 上这套版本对应哪棵树」；
 * - 里程碑 tag `milestone/<major>.<minor>`：跟 core 的 minor 兼容线走
 *   （与插件 peer `^1.0.0` 的边界一致），annotated + GitHub Release，
 *   封面正文由本命令生成骨架，人改完再发布。
 *
 * 正文口径：区间是「上一个里程碑 tag → HEAD」，没有里程碑 tag 时回退到
 * 历史遗留的 `v*` tag（1.1 线由 v1.1.5 / v1.1.8 代表）；版本表只列区间内
 * 升版的包（changesets ignore 的 shim 四包除外）；条目取各包 CHANGELOG 的
 * 新增 bullet，剔除 `Updated dependencies` 与纯 `@koishi-ce/x@1.2.3` 连带
 * 升版行；同一 changeset 在多个包下重复（连带升版）时只保留一次。
 *
 * 为什么正文写到 stdout、进度写到 stderr：CI 里以重定向取正文
 * （`bun run release notes > release-notes.md`），同一条流上混进度会污染
 * markdown。
 */
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ROOT } from "../core/options.ts";
import { capture } from "../core/proc.ts";
import { discoverPackages } from "../core/workspace.ts";

/** 一个 changeset 条目（归属包 + 正文）。 */
export interface ChangelogEntry {
	/** 条目所属包名。 */
	package: string;
	/** 条目正文（续行以空格并入）。 */
	text: string;
}

/** 与上一个 tag 相比的版本变化；`before` 为 null 表示该包首发。 */
export interface VersionBump {
	name: string;
	before: string | null;
	after: string;
}

/** 骨架输入。 */
export interface NotesInput {
	/** 本次要打的 tag（如 `v1.1.8`）。 */
	tag: string;
	/** 上一个 v* tag（如 `v1.1.5`）。 */
	previousTag: string;
	/** 区间内提交数。 */
	commits: number;
	/** 升版的包（版本表顺序即发布面顺序）。 */
	bumps: readonly VersionBump[];
	/** 已去重的 changeset 条目。 */
	entries: readonly ChangelogEntry[];
	/** 区间内带 PR 号的提交标题。 */
	pulls: readonly string[];
}

/** 是否属于「依赖连带升版」噪音行（含 `Updated dependencies` 块）。 */
function isDependencyNoise(text: string): boolean {
	return (
		text.startsWith("Updated dependencies") ||
		/^@koishi-ce\/[\w-]+@\d/.test(text)
	);
}

/**
 * 解析 `git diff prev..HEAD -- '**\/CHANGELOG.md'` 的新增行。
 *
 * 只认 `+++ b/<包目录>/CHANGELOG.md` 切包、`+- ` 开头的 bullet，以及缩进
 * 续行（changeset 正文的多段描述）；`+## 1.2.3` 之类的版本小节标题不单独
 * 输出——骨架按包归并，版本区间已由版本表表达。
 */
export function parseChangelogDiff(
	diff: string,
	nameByPath: ReadonlyMap<string, string>,
): ChangelogEntry[] {
	const entries: ChangelogEntry[] = [];
	let current: string | undefined;
	let last: ChangelogEntry | undefined;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++ b/")) {
			const path = line
				.slice("+++ b/".length)
				.replace(/\/CHANGELOG\.md$/, "");
			current = nameByPath.get(path);
			last = undefined;
			continue;
		}
		if (current === undefined || !line.startsWith("+")) {
			continue;
		}
		const body = line.slice(1);
		const bullet = /^-\s+(\S.*)$/.exec(body);
		if (bullet !== null) {
			const text = (bullet[1] ?? "").trim();
			if (text === "" || isDependencyNoise(text)) {
				last = undefined;
				continue;
			}
			last = { package: current, text };
			entries.push(last);
			continue;
		}
		// changeset 正文的续行（缩进段落）：并进上一条，保留细节
		if (last !== undefined && /^\s{2,}\S/.test(body)) {
			last.text = `${last.text} ${body.trim()}`;
		}
	}
	return entries;
}

/** 按包归并条目，保持首次出现的顺序（与 CHANGELOG 的目录序一致）。 */
function groupByPackage(
	entries: readonly ChangelogEntry[],
): [string, ChangelogEntry[]][] {
	const grouped = new Map<string, ChangelogEntry[]>();
	for (const entry of entries) {
		const list = grouped.get(entry.package) ?? [];
		list.push(entry);
		grouped.set(entry.package, list);
	}
	return [...grouped];
}

/** 单条 bullet 的最大展示长度（changeset 正文常是数千字，骨架不该整段搬）。 */
export const BULLET_LIMIT = 160;

/** 截断超长条目；尾部加省略号并指向 CHANGELOG，正文细节仍在原地可查。 */
export function clipBullet(text: string): string {
	return text.length <= BULLET_LIMIT
		? text
		: `${text.slice(0, BULLET_LIMIT)}…（详见 CHANGELOG）`;
}

/**
 * 把条目拆成「跨包批量变更」与「单包明细」两组。
 *
 * 同一 changeset 常以连带升版的形式写进多个包的 CHANGELOG（如 OIDC 信任
 * 验证一次性覆盖 27 个包），按首次出现归到某一个包名下会误导读者；这里
 * 把出现次数 > 1 的条目单独成节，单包条目才按包分节。
 */
export function splitEntries(
	entries: readonly ChangelogEntry[],
): {
	shared: ChangelogEntry[];
	scoped: ChangelogEntry[];
} {
	const counts = new Map<string, number>();
	for (const entry of entries) {
		counts.set(
			entry.text,
			(counts.get(entry.text) ?? 0) + 1,
		);
	}
	const shared: ChangelogEntry[] = [];
	const scoped: ChangelogEntry[] = [];
	const emitted = new Set<string>();
	for (const entry of entries) {
		if ((counts.get(entry.text) ?? 0) > 1) {
			if (emitted.has(entry.text)) {
				continue;
			}
			emitted.add(entry.text);
			shared.push(entry);
			continue;
		}
		scoped.push(entry);
	}
	return { shared, scoped };
}

/** 版本区间文本（首发带前缀）。 */
function versionRange(bump: VersionBump): string {
	return bump.before === null
		? `首发 ${bump.after}`
		: `${bump.before} → ${bump.after}`;
}

/** 由上述素材拼出 markdown 骨架。 */
export function formatNotes(input: NotesInput): string {
	const lines: string[] = [
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
			lines.push(
				`| \`${bump.name}\` | ${versionRange(bump)} |`,
			);
		}
	}
	const bumpByPackage = new Map(
		input.bumps.map((bump) => [bump.name, bump]),
	);
	const { shared, scoped } = splitEntries(input.entries);
	if (shared.length > 0) {
		lines.push("", "## 跨包批量变更", "");
		for (const entry of shared) {
			lines.push(`- ${clipBullet(entry.text)}`);
		}
	}
	if (scoped.length > 0) {
		lines.push("", "## 变更明细");
		for (const [name, list] of groupByPackage(scoped)) {
			const bump = bumpByPackage.get(name);
			lines.push(
				"",
				`### \`${name}\`${bump === undefined ? "" : `（${versionRange(bump)}）`}`,
			);
			for (const entry of list) {
				lines.push(`- ${clipBullet(entry.text)}`);
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
		const manifest = JSON.parse(raw) as {
			version?: unknown;
		};
		return typeof manifest.version === "string"
			? manifest.version
			: null;
	} catch {
		return null;
	}
}

/** 包目录相对仓库根的 posix 路径（git 输出口径）。 */
function posixDir(dir: string): string {
	return relative(ROOT, dir).split(sep).join("/");
}

/**
 * changesets ignore 名单（shim 四包：版本冻结跟随上游线、不参与变更集）。
 * 它们若在区间内首次出现会被 `git show` 判成「首发」，写进版本表会误导
 * ——版本表只列 changesets 管理的包。
 */
function readIgnoredNames(
	root: string,
): ReadonlySet<string> {
	try {
		const config = JSON.parse(
			readFileSync(
				join(root, ".changeset", "config.json"),
				"utf8",
			),
		) as { ignore?: unknown };
		return new Set(
			Array.isArray(config.ignore)
				? config.ignore.filter(
						(name): name is string =>
							typeof name === "string",
					)
				: [],
		);
	} catch {
		return new Set();
	}
}

/**
 * notes：只读，输出 markdown 到 stdout。
 *
 * tag 名取 core 的 major.minor（`milestone/1.1`）。基线用
 * `git describe --match 'milestone/*' --match 'v*'` 取：优先上一个里程碑，
 * 没有里程碑时回退到历史遗留的 `v*` tag（1.1 线由 v1.1.5 / v1.1.8 代表）；
 * 两者都没有才回退到仓库首个提交。`--exclude` 排掉同名 tag，本地在已打
 * 里程碑的提交上重跑时不会退化成空 diff。
 */
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
	const line = core.version
		.split(".")
		.slice(0, 2)
		.join(".");
	const tag = `milestone/${line}`;
	const previousTag =
		capture(
			"git",
			[
				"describe",
				"--tags",
				"--abbrev=0",
				"--match",
				"milestone/*",
				"--match",
				"v*",
				"--exclude",
				tag,
				"HEAD",
			],
			ROOT,
		) ||
		capture(
			"git",
			["rev-list", "--max-parents=0", "HEAD"],
			ROOT,
		);
	if (previousTag === null || previousTag === "") {
		process.stderr.write(
			"[notes] ❌ 找不到基线（既无里程碑 / v* tag，也无提交历史）\n",
		);
		return 1;
	}
	const commits = Number.parseInt(
		capture(
			"git",
			["rev-list", "--count", `${previousTag}..HEAD`],
			ROOT,
		) ?? "0",
		10,
	);
	const bumps: VersionBump[] = [];
	const ignored = readIgnoredNames(ROOT);
	for (const pkg of pkgs) {
		if (ignored.has(pkg.name)) {
			continue;
		}
		const raw = capture(
			"git",
			[
				"show",
				`${previousTag}:${posixDir(pkg.dir)}/package.json`,
			],
			ROOT,
		);
		const before = raw === null ? null : readVersion(raw);
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
	const diff =
		capture(
			"git",
			[
				"diff",
				"--unified=0",
				`${previousTag}..HEAD`,
				"--",
				"*/CHANGELOG.md",
			],
			ROOT,
		) ?? "";
	const entries = parseChangelogDiff(diff, nameByPath);
	const { shared, scoped } = splitEntries(entries);
	const pulls = (
		capture(
			"git",
			[
				"log",
				"--format=%s",
				"--reverse",
				`${previousTag}..HEAD`,
			],
			ROOT,
		) ?? ""
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
