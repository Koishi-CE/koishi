// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 上游巡检脚本（零依赖，bun 直跑）。
 *
 * 用法：
 *   bun tooling/upstream-audit.ts               刷新上游缓存并输出目录对比底稿
 *   bun tooling/upstream-audit.ts --no-refresh  只对比不联网（缓存已有内容）
 *   bun tooling/upstream-audit.ts --only webui  只处理名称匹配（子串）的上游
 *
 * 上游源码一律克隆到仓库之外的缓存目录（默认本仓 ../upstream-cache，
 * 可用环境变量 KOISHI_CE_UPSTREAM_CACHE 改写），避免污染工作区。
 *
 * 产出是一份 markdown「底稿」：每个映射目录给出仅一侧存在的文件、
 * 共同文件经 `git diff --no-index -w`（压制缩进 / 空白噪音）的改动量
 * 排行。语义判断（是不是该 port、是否本仓刻意分叉）仍由人工完成，
 * 流程与判定标准见 docs/process/upstream.md 的 Routine inspection 节。
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/** 仓库根目录（本脚本位于 tooling/ 下）。 */
const ROOT = resolve(import.meta.dirname, "..");

/** 上游缓存目录：默认仓库同级，绝不落在仓库内部。 */
const CACHE =
	process.env.KOISHI_CE_UPSTREAM_CACHE ??
	resolve(ROOT, "..", "upstream-cache");

/** 汇总排除的目录段与文件后缀：产物 / 测试在目录对比里只产生噪音。 */
const IGNORE_SEGMENTS = new Set([
	"lib",
	"dist",
	"node_modules",
	"coverage",
	"__tests__",
	"tests",
	".github",
	".git",
]);
const IGNORE_SUFFIXES = [".test.ts", ".spec.ts", ".map"];
const IGNORE_NAMES = new Set([
	"package.json",
	"README.md",
	"CHANGELOG.md",
	".gitignore",
	".npmignore",
	"tsconfig.json",
	"tsconfig.client.json",
]);

/** 单条目录映射：上游子路径 → 本仓目录。up 为 "." 表示仓库根。 */
interface Mapping {
	up: string;
	ours: string;
	/** glob 映射（如 plugins/* → plugins/webui/*）：按上游子目录展开。 */
	glob?: boolean;
	/** 跳过内容对比（vendored 预编译产物等），只在底稿里记录存在。 */
	skipDiff?: boolean;
	note?: string;
}

/** 单个上游仓库：克隆地址 + 基线注记 + 映射清单。 */
interface Upstream {
	name: string;
	url: string;
	baseline: string;
	mappings: Mapping[];
}

/**
 * 巡检清单：与 docs/process/upstream.md 的 Restructure map 一一对应。
 * URL 一律写当前有效地址（仓库改名后旧地址虽会重定向，落盘以新名为准）。
 */
const UPSTREAMS: Upstream[] = [
	{
		name: "koishi",
		url: "https://github.com/koishijs/koishi.git",
		baseline:
			"koishi@4.18.11 线（master 领先量很小，见底稿 HEAD 行）",
		mappings: [
			{ up: "packages/core", ours: "packages/node/core" },
			{ up: "packages/koishi", ours: "packages/node/cli" },
			{
				up: "packages/loader",
				ours: "packages/node/loader",
			},
			{ up: "packages/utils", ours: "packages/node/utils" },
			{
				up: "packages/i18n-utils",
				ours: "packages/node/i18n-utils",
			},
			{
				up: "plugins/hmr",
				ours: "plugins/infra/hmr",
				note: "本仓 Bun 原生化重写，diff 仅作线索",
			},
			{ up: "plugins/mock", ours: "plugins/infra/mock" },
			{
				up: "plugins/common",
				ours: "plugins/common",
				glob: true,
			},
			{
				up: "plugins/http",
				ours: "plugins/infra/http",
				skipDiff: true,
				note: "vendored 预编译产物",
			},
			{
				up: "plugins/proxy-agent",
				ours: "plugins/infra/proxy",
				skipDiff: true,
				note: "vendored 预编译产物（上游目录名不同）",
			},
			{
				up: "plugins/server",
				ours: "plugins/infra/server",
				skipDiff: true,
				note: "vendored 预编译产物",
			},
		],
	},
	{
		name: "webui",
		url: "https://github.com/koishijs/webui.git",
		baseline:
			"@koishijs/plugin-console@5.30.11 线；bootstrap 取 2026-06-27 main 快照，market 对齐 v2.11.11",
		mappings: [
			{
				up: "packages/console",
				ours: "packages/node/console",
			},
			{
				up: "packages/registry",
				ours: "packages/node/registry",
			},
			{
				up: "packages/client",
				ours: "packages/web/client",
				note: "本仓 devMode fork，diff 仅作线索",
			},
			{
				up: "packages/components",
				ours: "packages/web/components",
			},
			{
				up: "plugins/*",
				ours: "plugins/webui/*",
				glob: true,
				note: "market 客户端视图为本地化 fork，禁止整覆盖",
			},
		],
	},
	{
		name: "assets",
		url: "https://github.com/koishijs/assets.git",
		baseline:
			"@koishijs/assets@1.1.2（上游 2024-05 起停滞）",
		mappings: [
			{ up: "packages/core", ours: "packages/node/assets" },
			{
				up: "packages/local",
				ours: "plugins/common/assets-local",
			},
		],
	},
	{
		name: "common",
		url: "https://github.com/koishijs/common.git",
		baseline:
			"@koishijs/plugin-rate-limit@1.3.3 线（monorepo 内 2.x）",
		mappings: [
			{
				up: "packages/rate-limit",
				ours: "plugins/common/rate-limit",
			},
		],
	},
	{
		name: "cron",
		url: "https://github.com/koishijs/koishi-plugin-cron.git",
		baseline: "仅参考：本仓以 Bun.cron 原生重写，非移植",
		mappings: [],
	},
	{
		name: "cordiverse-server",
		url: "https://github.com/cordiverse/server.git",
		baseline:
			"@koishijs/plugin-server-temp@1.5.0；上游 2025-03-19 起删除了 temp 包（线已死，仅存档）",
		mappings: [
			{
				up: "packages/temp",
				ours: "plugins/infra/server-temp",
			},
		],
	},
	{
		name: "dataview",
		url: "https://github.com/koishijs/koishi-plugin-dataview.git",
		baseline: "koishi-plugin-dataview@2.7.8",
		mappings: [{ up: ".", ours: "plugins/webui/dataview" }],
	},
	{
		name: "theme-vanilla",
		url: "https://github.com/koishijs/koishi-plugin-theme-vanilla.git",
		baseline:
			"koishi-plugin-theme-vanilla@1.1.0（仓库已由 theme-vanilla 改名）",
		mappings: [
			{ up: ".", ours: "plugins/webui/theme-vanilla" },
		],
	},
	{
		name: "database",
		url: "https://github.com/cordiverse/database.git",
		baseline:
			"3 线 @minatojs/driver-memory@3.7.0 / driver-sqlite@4.7.0；仓库已由 cordiverse/minato 改名，master 为 cordis 4 线",
		mappings: [
			{
				up: "packages/memory",
				ours: "plugins/infra/memory",
				note: "两源合并之一（驱动实现），master 已 4 线",
			},
			{
				up: "packages/sqlite",
				ours: "plugins/infra/sqlite",
				note: "三源合并之一（3 线驱动），master 已 4 线",
			},
		],
	},
	{
		name: "koishijs-upstream",
		url: "https://github.com/koishijs/upstream.git",
		baseline:
			"memory / sqlite 包装层 3.7.0 / 4.7.0（re-export 三行，多年未动）",
		mappings: [
			{
				up: "database/memory",
				ours: "plugins/infra/memory",
				note: "两源合并之一（包装层）",
			},
			{
				up: "database/sqlite",
				ours: "plugins/infra/sqlite",
				note: "三源合并之一（包装层）",
			},
		],
	},
];

/** 收集目录下全部文件（Bun.Glob），返回相对仓库/上游根的 posix 风格路径。 */
function collectFiles(dir: string): string[] {
	return [
		...new Bun.Glob("**/*").scanSync({
			cwd: dir,
			onlyFiles: true,
		}),
	]
		.map((file) => file.split(sep).join("/"))
		.filter((file) => !isIgnored(file))
		.sort();
}

/** 按排除规则过滤相对路径（目录段 / 后缀 / 文件名三闸）。 */
function isIgnored(rel: string): boolean {
	const segments = rel.split("/");
	if (
		segments
			.slice(0, -1)
			.some((s) => IGNORE_SEGMENTS.has(s))
	)
		return true;
	if (IGNORE_SUFFIXES.some((s) => rel.endsWith(s)))
		return true;
	const last = segments.at(-1);
	return last !== undefined && IGNORE_NAMES.has(last);
}

/** 跑一条子进程命令，返回 stdout（git diff --no-index 的退出码 1 表示有差异，不是错误）。 */
function run(
	cmd: string,
	args: string[],
	cwd?: string,
): { out: string; code: number } {
	const result = spawnSync(cmd, args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	return {
		out: (result.stdout ?? "") + (result.stderr ?? ""),
		code: result.status ?? -1,
	};
}

/** 单文件 -w numstat：返回 [增行, 删行]，二进制记 [1, 1]。 */
function numstat(
	oursFile: string,
	upFile: string,
): [number, number] {
	const { out } = run("git", [
		"diff",
		"--no-index",
		"-w",
		"--numstat",
		"--",
		oursFile,
		upFile,
	]);
	const line = out.trim().split("\t");
	if (line.length < 3) return [0, 0];
	const [add, del] = line;
	if (add === "-") return [1, 1];
	return [Number(add), Number(del)];
}

/** 对比一对目录，往报告行里写结论。 */
function compareMapping(
	upstreamDir: string,
	oursDir: string,
	lines: string[],
): void {
	const upFiles = collectFiles(upstreamDir);
	const oursFiles = collectFiles(oursDir);
	const upSet = new Set(upFiles);
	const oursSet = new Set(oursFiles);
	const onlyUp = upFiles.filter((f) => !oursSet.has(f));
	const onlyOurs = oursFiles.filter((f) => !upSet.has(f));
	const common = upFiles.filter((f) => oursSet.has(f));

	lines.push(
		`仅上游有 ${onlyUp.length} 个、仅本仓有 ${onlyOurs.length} 个、共同 ${common.length} 个（均不含已排除的产物与测试）。`,
	);
	for (const f of onlyUp.slice(0, 20))
		lines.push(`  - 上游独有: ${f}`);
	if (onlyUp.length > 20)
		lines.push(`  - ……另有 ${onlyUp.length - 20} 个`);
	for (const f of onlyOurs.slice(0, 20))
		lines.push(`  - 本仓独有: ${f}`);
	if (onlyOurs.length > 20)
		lines.push(`  - ……另有 ${onlyOurs.length - 20} 个`);

	// 共同文件按真实改动量排序（-w 压掉缩进噪音后仍大的才值得人工看）
	const churn: {
		file: string;
		add: number;
		del: number;
	}[] = [];
	for (const f of common) {
		const [add, del] = numstat(
			join(oursDir, f),
			join(upstreamDir, f),
		);
		if (add || del) churn.push({ file: f, add, del });
	}
	churn.sort((a, b) => b.add + b.del - (a.add + a.del));
	if (!churn.length) {
		lines.push("共同文件在 -w 口径下零差异。");
		return;
	}
	lines.push(
		`-w 口径下有差异的共同文件 ${churn.length} 个，改动量 Top：`,
	);
	for (const { file, add, del } of churn.slice(0, 15)) {
		lines.push(`  - ${file}  +${add} / -${del}`);
	}
	if (churn.length > 15)
		lines.push(`  - ……另有 ${churn.length - 15} 个`);
}

/** glob 映射展开：按上游子目录逐个配对本仓同名目录（repoRoot 为上游仓库根）。 */
function expandGlob(
	repoRoot: string,
	mapping: Mapping,
): { up: string; ours: string }[] {
	const base = mapping.up.replace(/\/\*$/, "");
	const entries = Array.from(
		new Bun.Glob("*").scanSync({
			cwd: join(repoRoot, base),
			onlyFiles: false,
			dot: false,
		}),
	);
	return entries
		.map((name) => ({
			up: `${base}/${name}`,
			ours: mapping.ours.replace(/\*$/, name),
		}))
		.filter(({ ours }) => existsSync(join(ROOT, ours)));
}

// ---------------------------------------------------------------- 主流程

const args = process.argv.slice(2);
const noRefresh = args.includes("--no-refresh");
const onlyArg = args.find(
	(_, i) => args[i - 1] === "--only",
);

const lines: string[] = [
	`# 上游巡检底稿（${new Date().toISOString().slice(0, 10)} 生成）`,
	"",
	`缓存目录：${CACHE}（仓库外，不入 git）`,
	"",
	"> 这是脚本自动产出的原始对比，用于人工 triage；结论性报告见 docs/process/upstream.md。",
	"",
];

for (const upstream of UPSTREAMS) {
	if (onlyArg && !upstream.name.includes(onlyArg)) continue;
	const dir = join(CACHE, upstream.name);
	lines.push(`## ${upstream.name} — ${upstream.url}`);
	lines.push(`基线：${upstream.baseline}`);

	// 刷新（或补克隆）缓存；--no-refresh 时缺缓存则跳过该上游
	if (!noRefresh) {
		if (!existsSync(dir)) {
			const { code } = run("git", [
				"clone",
				"--quiet",
				"--depth",
				"1",
				upstream.url,
				dir,
			]);
			lines.push(
				code === 0
					? "缓存：新克隆。"
					: "缓存：克隆失败（网络？），本次跳过。",
			);
		} else {
			const { code } = run(
				"git",
				["pull", "--quiet", "--ff-only"],
				dir,
			);
			lines.push(
				code === 0
					? "缓存：已刷新。"
					: "缓存：刷新失败（本地有改动或离线），沿用现有内容。",
			);
		}
	}
	if (!existsSync(dir)) {
		lines.push("缓存不存在，跳过。", "");
		continue;
	}

	const head = run(
		"git",
		["log", "-1", "--format=%h %ad %s", "--date=short"],
		dir,
	).out.trim();
	lines.push(`HEAD：${head}`);

	if (!upstream.mappings.length) {
		lines.push("（无目录映射，仅跟踪仓库动态。）", "");
		continue;
	}
	for (const mapping of upstream.mappings) {
		const upstreamDir = resolve(
			dir,
			mapping.up === "." ? "" : mapping.up,
		);
		const oursDir = join(
			ROOT,
			mapping.ours.replace(/\*$/, ""),
		);
		lines.push("");
		lines.push(
			`### ${mapping.up} → ${mapping.ours}${mapping.note ? `（${mapping.note}）` : ""}`,
		);
		if (mapping.skipDiff) {
			lines.push(
				"vendored 预编译产物，不做内容对比；重打包时人工核上游 changelog。",
			);
			continue;
		}
		if (mapping.glob) {
			const base = mapping.up.replace(/\/\*$/, "");
			if (!existsSync(join(dir, base))) {
				lines.push(
					"上游目录已不存在（可能被删除 / 改名），单独核实。",
				);
				continue;
			}
			const subs = expandGlob(dir, mapping);
			for (const sub of subs) {
				lines.push("");
				lines.push(`#### ${sub.up} → ${sub.ours}`);
				compareMapping(
					join(dir, sub.up),
					join(ROOT, sub.ours),
					lines,
				);
			}
			// glob 配不上对的子目录是独立信号：上游可能新增 / 改名了插件
			const matched = new Set(subs.map((s) => s.up));
			const all = Array.from(
				new Bun.Glob("*").scanSync({
					cwd: join(dir, base),
					onlyFiles: false,
					dot: false,
				}),
			);
			for (const name of all) {
				if (!matched.has(`${base}/${name}`))
					lines.push(
						`- 上游子目录无本仓对应：${base}/${name}`,
					);
			}
			continue;
		}
		if (!existsSync(upstreamDir)) {
			lines.push(
				"上游目录已不存在（可能被删除 / 改名），单独核实。",
			);
			continue;
		}
		if (!existsSync(oursDir)) {
			lines.push("本仓目录缺失，单独核实。");
			continue;
		}
		compareMapping(upstreamDir, oursDir, lines);
	}
	lines.push("");
}

const report = lines.join("\n");
console.log(report);
