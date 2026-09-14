// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * vue-tsc 影子基线闸门（.vue 全量类型错误快照对比，bun 直跑）。
 *
 * 用法：
 *   bun tooling/checks/vue-types.ts           # 默认模式：与基线对比，出现新增错误键则退出码 1
 *   bun tooling/checks/vue-types.ts --update  # 重拍快照写入基线 JSON
 *
 * 背景：全仓类型检查走 TS7（@typescript/native），其 Volar 工具链尚未
 * 就绪，.vue 文件不进入 tsc 程序（经 global.d.ts 声明为不透明 Component，
 * 错误实际由前端构建期的 compiler-sfc 暴露）。本脚本用 vue-tsc（经典
 * TS 5.9 运行时）对 tsconfig.web.json 做全量检查，把错误快照落盘为基线：
 * 门禁只拦「新增」、容忍「存量」——存量随修复自然消化，待 Volar 支持
 * TS7 后影子基线即可转正退役。
 *
 * 两个硬前提（勿改，详见 docs/guides/development.md 已知坑）：
 *   1. vue-tsc 必须装在隔离目录（node_modules/.cache/vue-tsc-shadow，
 *      天然被 git 忽略）：仓库根 typescript 是 @typescript/typescript6
 *      别名包，vue-tsc 对 typescript/lib/tsc 的深路径引用被其 exports
 *      挡住，bunx 直跑直接崩（ERR_PACKAGE_PATH_NOT_EXPORTED）；
 *   2. vue-tsc 必须用 node 跑：bun 直跑会静默失效（不产出检查结果）。
 *
 * 归一化键为 `<file>::<code>::<message>`（不含行列号——行号会随修复
 * 漂移，同文件同错误挪行不应算新增）；file 含 node_modules/ 的条目一律
 * 丢弃（第三方 .vue 不算本仓的债）。
 */
import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import {
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";

/** 仓库根目录（本脚本位于 tooling/checks/ 下）。 */
const ROOT = resolve(import.meta.dirname, "../..");

/** 影子环境钉死的工具版本（升级须重拍基线，两边版本强绑定）。 */
const VUE_TSC_VERSION = "3.3.11";
const TYPESCRIPT_VERSION = "5.9.3";

/** 影子环境目录（仓库内 node_modules 缓存，git 天然忽略）。 */
const CACHE_DIR = join(
	ROOT,
	"node_modules",
	".cache",
	"vue-tsc-shadow",
);

/** vue-tsc 可执行入口（自举完成的判定标志）。 */
const VUE_TSC_BIN = join(
	CACHE_DIR,
	"node_modules",
	"vue-tsc",
	"bin",
	"vue-tsc.js",
);

/** 基线 JSON 路径（随仓库提交）。 */
const BASELINE_PATH = resolve(
	import.meta.dirname,
	"vue-types-baseline.json",
);

/**
 * 自举影子环境：vue-tsc 就位则跳过，否则在隔离目录安装钉版组合。
 * 自举失败（如离线）时输出中文说明并退出码 1。
 */
async function ensureShadowInstall() {
	if (existsSync(VUE_TSC_BIN)) return;
	mkdirSync(CACHE_DIR, { recursive: true });
	// 预写独立 package.json：否则 bun add 会沿目录向上吸附到仓库根
	// workspace，把依赖装进根 node_modules 并改写根 package.json/bun.lock
	// （2026-09-14 实证）；影子目录自带 package.json 即为独立项目根
	const manifest = join(CACHE_DIR, "package.json");
	if (!existsSync(manifest)) {
		writeFileSync(
			manifest,
			'{"name":"vue-tsc-shadow","private":true}\n',
		);
	}
	console.log(
		`首次运行：正在自举 vue-tsc 影子环境（vue-tsc@${VUE_TSC_VERSION} + typescript@${TYPESCRIPT_VERSION}）...`,
	);
	const proc = Bun.spawn({
		// process.execPath 即当前 bun 可执行文件，避免依赖 PATH 解析
		cmd: [
			process.execPath,
			"add",
			`vue-tsc@${VUE_TSC_VERSION}`,
			`typescript@${TYPESCRIPT_VERSION}`,
		],
		cwd: CACHE_DIR,
		// 跨进程环境一律显式展开（Bun.spawn 隐式继承不取运行时赋值）
		env: { ...process.env },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0 || !existsSync(VUE_TSC_BIN)) {
		console.error(
			"vue-tsc 影子环境自举失败（可能离线或 registry 不可达），可稍后重试。安装输出：",
		);
		console.error(
			stdout.trim() || stderr.trim() || "（无输出）",
		);
		process.exit(1);
	}
}

/**
 * 用 node 跑影子环境的 vue-tsc，全量检查 tsconfig.web.json。
 * 返回 stdout 文本（错误清单）；进程自身崩溃（退出码非 0/1 或无输出）时退出码 1。
 */
async function runVueTsc(): Promise<string> {
	// 裸名 "node" 的 spawn 解析在 win32 上不可靠（PATH 中存在
	// mise shim / WindowsApps 存根等多重 node，可能 ENOENT 或静默
	// 非零退出），先解析出绝对路径再 spawn
	const nodeBin = Bun.which("node");
	if (!nodeBin) {
		console.error(
			"未在 PATH 中找到 node（vue-tsc 必须用 node 跑，见已知坑）",
		);
		process.exit(1);
	}
	const proc = Bun.spawn({
		cmd: [
			nodeBin,
			VUE_TSC_BIN,
			"--noEmit",
			"-p",
			join(ROOT, "tsconfig.web.json"),
			"--pretty",
			"false",
		],
		cwd: ROOT,
		env: {
			...process.env,
			NODE_OPTIONS: "--max-old-space-size=8192",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	// 有错误时 vue-tsc 的退出码不稳定（--noEmit 有诊断时 1 与 2 均实测
	// 出现过，Volar 包装所致），不能作为判据；崩溃识别以「退出码非 0
	// 且 stdout 无任何诊断行」为准（如 OOM 崩溃时不产出错误清单）
	if (code !== 0 && !stdout.trim()) {
		console.error(`vue-tsc 执行失败（退出码 ${code}）：`);
		console.error(stderr.trim() || "（stderr 无输出）");
		process.exit(1);
	}
	return stdout;
}

/** 单条类型错误（file 为相对仓库根的正斜杠路径）。 */
type Entry = {
	file: string;
	line: number;
	code: string;
	message: string;
};

/**
 * 解析 vue-tsc 的 tsc 风格输出（`path(line,col): error TSxxxx: message`），
 * 丢弃 node_modules/ 内的条目；不匹配的行（汇总信息、多行详情）跳过。
 */
function parseEntries(stdout: string): Entry[] {
	const entries: Entry[] = [];
	for (const line of stdout.split(/\r?\n/)) {
		const match =
			/^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/.exec(
				line,
			);
		if (!match) continue;
		const rawFile = match[1] ?? "";
		const file = (
			isAbsolute(rawFile)
				? relative(ROOT, rawFile)
				: rawFile
		).replaceAll("\\", "/");
		if (file.includes("node_modules/")) continue;
		entries.push({
			file,
			line: Number(match[2] ?? 0),
			code: match[3] ?? "",
			// 消息正文可能嵌入依赖解析出的绝对路径（如 TS7016 报缺失
			// 声明的模块路径）：checkout 目录名与平台分隔符差异会让同一
			// 条错误在不同机器上生成不同的键——统一把仓库根（正反斜杠
			// 两种形态都替换，win32 下 tsc 消息内的路径是正斜杠形态）
			// 替换为 <root>、残余反斜杠归一为正斜杠，保证键跨机器稳定
			message: (match[4] ?? "")
				.split(ROOT)
				.join("<root>")
				.split(ROOT.replaceAll("\\", "/"))
				.join("<root>")
				.replaceAll("\\", "/")
				// vue-tsc 程序的文件加载顺序在两次运行间不完全一致，
				// union 成员的打印顺序随之漂移（同一条 TS2322 在两次
				// 运行里构造器序列不同，会让基线键随机横跳成假新增）。
				// 对「括号内全为简单标识符、竖线分隔」的 union 段按
				// 字典序重排保证键跨运行稳定（union 顺序在类型语义上
				// 无意义；含括号/箭头等复杂成员的段不匹配、原样保留）
				.replace(
					/\((\w+(?:\s+\|\s+\w+)+)\)/g,
					(whole: string, inner: string) => {
						const parts = inner
							.split("|")
							.map((part) => part.trim());
						if (parts.some((part) => !/^\w+$/.test(part)))
							return whole;
						return `(${[...parts].sort().join(" | ")})`;
					},
				),
		});
	}
	return entries;
}

/** 归一化键：文件 + 错误码 + 消息（不含行列号）。 */
function keyOf(entry: Entry): string {
	return `${entry.file}::${entry.code}::${entry.message}`;
}

/** 读取并校验基线 JSON，返回错误键数组。 */
function loadBaseline(): string[] {
	if (!existsSync(BASELINE_PATH)) {
		console.error(
			"基线 JSON 不存在，请先重拍：bun tooling/checks/vue-types.ts --update",
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
			`基线 JSON 解析失败（${error}），请重拍：--update`,
		);
		process.exit(1);
	}
	const entries = (parsed as { entries?: unknown }).entries;
	if (
		!Array.isArray(entries) ||
		entries.some((item) => typeof item !== "string")
	) {
		console.error("基线 JSON 结构损坏，请重拍：--update");
		process.exit(1);
	}
	return entries as string[];
}

// ---------------------------------------------------------------- main

const update = process.argv.includes("--update");

await ensureShadowInstall();
console.log("vue-tsc 全量检查中（约需一两分钟）...");
const stdout = await runVueTsc();
const current = [
	...new Set(parseEntries(stdout).map(keyOf)),
].sort();

if (update) {
	writeFileSync(
		BASELINE_PATH,
		`${JSON.stringify(
			{
				meta: {
					generatedAt: new Date().toISOString(),
					vueTscVersion: VUE_TSC_VERSION,
					typescriptVersion: TYPESCRIPT_VERSION,
					total: current.length,
				},
				entries: current,
			},
			null,
			"\t",
		)}\n`,
	);
	console.log(
		`基线已更新：${current.length} 个存量错误键写入 ${relative(ROOT, BASELINE_PATH).replaceAll("\\", "/")}`,
	);
	process.exit(0);
}

const baseline = loadBaseline();
const baselineKeys = new Set(baseline);
const added = current.filter(
	(key) => !baselineKeys.has(key),
);
const currentKeys = new Set(current);
const fixedCount = baseline.filter(
	(key) => !currentKeys.has(key),
).length;

if (added.length) {
	console.error(
		`vue-tsc 影子基线检查失败：新增 ${added.length} 个错误键（存量 ${current.length - added.length} 个受基线容忍）：`,
	);
	for (const key of added) {
		console.error(`  + ${key}`);
	}
	console.error(
		"这些 .vue 类型错误不在基线内；若确认可接受，请连带重拍基线：--update",
	);
	process.exit(1);
}

console.log(
	`vue-tsc 影子基线检查通过：无新增错误键（存量 ${current.length} 个受基线容忍${
		fixedCount ? `，本次消除 ${fixedCount} 个` : ""
	}）。`,
);
