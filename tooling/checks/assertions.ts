// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 双重断言（as unknown as / as any as）基线闸门（bun 直跑，纯文本扫描）。
 *
 * 用法：
 *   bun tooling/checks/assertions.ts           # 默认模式：与基线对比，出现新增断言则退出码 1
 *   bun tooling/checks/assertions.ts --update  # 重扫全仓写入基线 JSON（已登记的理由自动结转）
 *
 * 背景：显式 any 全仓为 0（biome noExplicitAny 在 .ts 与 .vue script 生效），
 * 但 `as unknown as` 双重断言绕过一切类型检查、且 biome 不拦——存量 133 处
 * （2026-09-18 立项盘点）正在收敛（见任务五分法：根除 / 上移 / 有据保留 /
 * 测试桩 / 记录不修）。本闸门只拦「新增」：非测试源文件里的双重断言必须
 * 先登记基线（附一行根因理由）才能进仓，存量随修复自然消化。
 *
 * 扫描范围：packages / plugins / apps / tooling 下的 .ts / .mts / .vue，
 * 排除 node_modules、lib / dist 产物目录、vendor 目录（market 的
 * client/vendor）、vendored 预编译包（plugins/infra/{http,proxy,server} 与
 * packages/shim，硬性约束豁免清单）与测试文件（`__tests__` / `__mocks__`
 * 目录、`*.test.ts` / `*.spec.ts`——测试桩断言属五分法第 4 类，不进闸门）。
 *
 * 键设计：`文件 :: 类别 :: 断言所在行文本`（行文本去首尾空白、内部连续空白
 * 归一为单空格；不含行号——行号随编辑漂移，同文件挪行不算新增）。同一行
 * 出现 N 次按多重集合计 N 条（防「删一处又加一处」漏网）。
 *
 * 已知覆盖边界（不假装全覆盖）：
 *   - 注释行（// 与 * 开头）整体豁免——注释掉的断言不是活断言；行尾注释
 *     不豁免（断言本体在行内）。位于多行模板字符串中间、恰好以 * 开头的
 *     内容会被误豁免（可忽略的假阴性）；
 *   - 跨行的 `as unknown\nas` 形态行扫描取不到键——但闸门会做全文计数
 *     交叉核对，发现跨行形态直接判失败（要求改写为单行再登记）；
 *   - 模板字符串里的字面量 `as unknown as` 会被误计（宁误报不漏报，
 *     误报条目登记基线时注明即可）；
 *   - 单重危险 `as` 与非空断言 `!` 不在本闸门范围（任务第 5 类：记录不修）。
 *
 * 另设次级检查：.vue 的模板表达式内 `as any`（biome 与 eslint 均不查模板
 * 表达式，是显式 any 的唯一逃逸口；类类别键 any，注释行豁免）。.ts 内的
 * `as any` 已由 biome 拦截，不重复扫。
 */
import {
	existsSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

/** 仓库根目录（本脚本位于 tooling/checks/ 下）。 */
const ROOT = resolve(import.meta.dirname, "../..");

/** 扫描根（tooling 自身也受管：新增工具脚本同样不许带双重断言）。 */
const SCAN_ROOTS = [
	"packages",
	"plugins",
	"apps",
	"tooling",
];

/** 递归时不进入的目录名（产物 / 缓存 / 第三方）。 */
const SKIP_DIRS = new Set([
	"node_modules",
	"lib",
	"dist",
	".cache",
	"coverage",
	// market 的 client/vendor 是 @koishijs/market 的 vendored 产物（AGPL
	// 同许可、手动 diff 清单），全仓唯一的 vendor 目录，按名整体跳过
	"vendor",
]);

/** vendored / 冻结包前缀（正斜杠形态，硬性约束豁免清单，一律不扫）。 */
const EXEMPT_PREFIXES = [
	"plugins/infra/http/",
	"plugins/infra/proxy/",
	"plugins/infra/server/",
	"packages/shim/",
];

/** 双重断言（主目标）。 */
const DOUBLE_RE = /\bas\s+(?:unknown|any)\s+as\b/g;
/** .vue 模板 `as any`（次级检查；调用处须用非全局副本）。 */
const AS_ANY_RE = /\bas\s+any\b/;

/** 基线 JSON 路径（随仓库提交，兼作保留台账）。 */
const BASELINE_PATH = resolve(
	import.meta.dirname,
	"assertions-baseline.json",
);

/** 一处断言登记（file 为相对仓库根的正斜杠路径）。 */
type Entry = {
	file: string;
	/** double = 双重断言；any = .vue 模板 as any。 */
	kind: "double" | "any";
	/** 归一化行文本。 */
	snippet: string;
	/** 保留理由（有据保留的台账；缺省 = 待审计）。 */
	reason?: string;
};

/** 基线键（多重集合比较的单位）。 */
function keyOf(entry: Entry): string {
	return `${entry.file}::${entry.kind}::${entry.snippet}`;
}

/** 是否测试文件（五分法第 4 类，出闸门范围）。 */
function isTestFile(relPath: string): boolean {
	const normalized = relPath.replaceAll("\\", "/");
	if (
		normalized.includes("/__tests__/") ||
		normalized.includes("/__mocks__/")
	)
		return true;
	return /\.(?:test|spec)(?:-d)?\.[cm]?ts$/.test(
		normalized,
	);
}

/** 递归收集受扫描的源文件（相对仓库根、正斜杠路径——键跨平台稳定的必要归一）。 */
function collectFiles(dir: string, out: string[]): void {
	for (const item of readdirSync(dir, {
		withFileTypes: true,
	})) {
		// 符号链接一律不进（防 worktree / junction 逃出仓库视图）
		if (item.isSymbolicLink()) continue;
		const full = join(dir, item.name);
		if (item.isDirectory()) {
			if (SKIP_DIRS.has(item.name)) continue;
			const rel = relative(ROOT, full).replaceAll(
				"\\",
				"/",
			);
			if (
				EXEMPT_PREFIXES.some((prefix) =>
					rel.startsWith(prefix),
				)
			)
				continue;
			collectFiles(full, out);
			continue;
		}
		if (!item.isFile()) continue;
		if (!/\.(?:[cm]?ts|vue)$/.test(item.name)) continue;
		const rel = relative(ROOT, full).replaceAll("\\", "/");
		if (isTestFile(rel)) continue;
		out.push(rel);
	}
}

/** 归一化行文本：去首尾空白、连续空白归一单空格。 */
function normalizeLine(line: string): string {
	return line.trim().replaceAll(/\s+/g, " ");
}

/** 行是否注释（注释掉的断言不是活断言，两类扫描均豁免）。 */
function isCommentLine(normalized: string): boolean {
	return (
		normalized.startsWith("//") ||
		normalized.startsWith("/*") ||
		normalized.startsWith("*") ||
		normalized.startsWith("<!--")
	);
}

/**
 * 扫描单文件返回断言条目；发现跨行双重断言形态时收集到 crossLine 报告。
 * （行扫描取键 + 全文计数交叉核对，两层配合见文件头说明。）
 */
function scanFile(
	relPath: string,
	crossLine: string[],
): Entry[] {
	const content = readFileSync(join(ROOT, relPath), "utf8");
	const isVue = relPath.endsWith(".vue");
	const entries: Entry[] = [];
	let lineHits = 0;
	for (const rawLine of content.split(/\r?\n/)) {
		const line = normalizeLine(rawLine);
		if (isCommentLine(line)) continue;
		const doubles = line.match(DOUBLE_RE);
		if (doubles) {
			lineHits += doubles.length;
			// 同一行多次出现按次计入多重集合（键同文本重复，diff 时可辨）
			for (let i = 0; i < doubles.length; i++) {
				entries.push({
					file: relPath,
					kind: "double",
					snippet: line,
				});
			}
			continue;
		}
		// .vue 模板 as any：biome / eslint 均不查模板表达式，此处补位
		if (
			isVue &&
			AS_ANY_RE.test(line) &&
			!isCommentLine(line)
		) {
			entries.push({
				file: relPath,
				kind: "any",
				snippet: line,
			});
		}
	}
	// 交叉核对：在剔除注释行后的全文（允许跨行空白）上计数，与行扫描口径
	// 一致；大于行计数 = 存在跨行形态
	const codeOnly = content
		.split(/\r?\n/)
		.filter((line) => !isCommentLine(normalizeLine(line)))
		.join("\n");
	const wholeHits = codeOnly.match(
		new RegExp(DOUBLE_RE.source, "g"),
	)?.length;
	if ((wholeHits ?? 0) > lineHits) crossLine.push(relPath);
	return entries;
}

/** 全仓扫描。 */
function scanAll(): Entry[] {
	const files: string[] = [];
	for (const root of SCAN_ROOTS)
		collectFiles(join(ROOT, root), files);
	const crossLine: string[] = [];
	const entries: Entry[] = [];
	for (const file of files)
		entries.push(...scanFile(file, crossLine));
	if (crossLine.length) {
		console.error(
			`发现跨行双重断言（as unknown\\nas 形态，行扫描无法生成稳定键）：`,
		);
		for (const file of crossLine)
			console.error(`  ? ${file}`);
		console.error(
			"请改写为单行形态（或调整换行后）再登记基线。",
		);
		process.exit(1);
	}
	entries.sort((a, b) =>
		`${a.file}::${a.kind}::${a.snippet}` <
		`${b.file}::${b.kind}::${b.snippet}`
			? -1
			: 1,
	);
	return entries;
}

/** 读取并校验基线 JSON。 */
function loadBaseline(): Entry[] {
	if (!existsSync(BASELINE_PATH)) {
		console.error(
			"基线 JSON 不存在，请先重扫：bun tooling/checks/assertions.ts --update",
		);
		process.exit(1);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(
			readFileSync(BASELINE_PATH, "utf8"),
		);
	} catch (error) {
		console.error(
			`基线 JSON 解析失败（${error}），请重扫：--update`,
		);
		process.exit(1);
	}
	const entries = (parsed as { entries?: unknown }).entries;
	if (
		!Array.isArray(entries) ||
		entries.some(
			(item) =>
				typeof item !== "object" ||
				item === null ||
				typeof (item as Entry).file !== "string" ||
				typeof (item as Entry).snippet !== "string",
		)
	) {
		console.error("基线 JSON 结构损坏，请重扫：--update");
		process.exit(1);
	}
	return entries as Entry[];
}

/** 多重集合差：current 相对 baseline 的新增（保留插入序）。 */
function multisetAdded(
	current: Entry[],
	baseline: Entry[],
): Entry[] {
	const pool = new Map<string, number>();
	for (const entry of baseline) {
		const key = keyOf(entry);
		pool.set(key, (pool.get(key) ?? 0) + 1);
	}
	return current.filter((entry) => {
		const key = keyOf(entry);
		const left = pool.get(key) ?? 0;
		if (left <= 0) return true;
		pool.set(key, left - 1);
		return false;
	});
}

// ---------------------------------------------------------------- main

const update = process.argv.includes("--update");
const current = scanAll();

if (update) {
	// 已登记理由结转：同键的理由在重扫后自动保留（台账不因重拍丢账）
	const reasons = new Map<string, string>();
	if (existsSync(BASELINE_PATH)) {
		for (const old of loadBaseline()) {
			if (old.reason && !reasons.has(keyOf(old)))
				reasons.set(keyOf(old), old.reason);
		}
	}
	const entries = current.map((entry) => {
		const reason = reasons.get(keyOf(entry));
		return reason ? { ...entry, reason } : entry;
	});
	writeFileSync(
		BASELINE_PATH,
		`${JSON.stringify(
			{
				meta: {
					generatedAt: new Date().toISOString(),
					total: entries.length,
					// 待审计数：收敛任务进度指标（有据保留的条目都已附 reason）
					pending: entries.filter((entry) => !entry.reason)
						.length,
				},
				entries,
			},
			null,
			"\t",
		)}\n`,
	);
	console.log(
		`基线已更新：${entries.length} 处断言写入 ${relative(ROOT, BASELINE_PATH).replaceAll("\\", "/")}（待审计 ${entries.filter((e) => !e.reason).length} 处）`,
	);
	process.exit(0);
}

const baseline = loadBaseline();
const added = multisetAdded(current, baseline);
const fixedCount = multisetAdded(baseline, current).length;
const pending = baseline.filter(
	(entry) => !entry.reason,
).length;

if (added.length) {
	console.error(
		`双重断言基线检查失败：新增 ${added.length} 处（存量 ${current.length - added.length} 处受基线容忍）：`,
	);
	for (const entry of added) {
		console.error(`  + ${entry.file} [${entry.kind}]`);
		console.error(`      ${entry.snippet}`);
	}
	console.error(
		"新增双重断言须先穷尽根除 / 上移修法（见 docs 任务五分法）；确属务实妥协的，登记基线并附一行理由后重扫：--update",
	);
	process.exit(1);
}

console.log(
	`双重断言基线检查通过：无新增（存量 ${current.length} 处受基线容忍${
		fixedCount ? `，本次消除 ${fixedCount} 处` : ""
	}；待审计 ${pending} 处）。`,
);
