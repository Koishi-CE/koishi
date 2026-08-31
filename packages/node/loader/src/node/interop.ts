/**
 * Bun require 的 ESM 入口分歧修复：require.cache 种子预置。
 *
 * 背景：Bun 把 package.json exports 的 "bun" 条件同时应用在 require 与
 * import 上（Node 的 require 条件集不含 "bun"）。声明了该条件的包——
 * 典型如 postgres@3.4.x，exports 依次为 types / bun→src/index.js（ESM）/
 * workerd / import / default→cjs/src/index.js（CJS）——在 Node 下被 CJS
 * 消费方 require 到 CJS 产物，而在 Bun 下 require 到 ESM namespace。上
 * 游经 esbuild 编译的 CJS 产物用 __toESM(mod, 1) 的 node 兼容 interop 包
 * 装依赖：isNodeMode 无条件把整个 required 对象当作 default，无视
 * namespace 自带的 __esModule 与 default——调用点拿到的是 namespace 而
 * 非函数，@minatojs/driver-postgres 的 start() 便抛 "is not a function
 * ... is an instance of Module"（同一链路在 Node 下无此问题）。
 *
 * 修复：加载插件前自插件包遍历依赖树（dependencies / peerDependencies /
 * optionalDependencies，进程内按包目录记忆化），对每个「Bun require 实
 * 际命中入口 ≠ Node require 语义入口」的包，把 Node 语义入口（CJS 产
 * 物）的 require 结果预置进 require.cache[Bun require 入口键]——消费方
 * require 的解析结果与缓存键即 require.resolve(spec, { paths: [消费方
 * 目录] }) 的返回（树内上下文为字面 node_modules 路径，实证与消费方一
 * 致）。ESM import 侧不读 require.cache（实证种子不影响 import），两侧
 * 互不干扰；无分歧的包不做任何动作，行为与未启用本逻辑时完全一致。
 *
 * 已知边界（刻意保守，宁可漏修不可误伤）：
 * - 仅识别 "." 主入口的扁平条件表与一层 "." 嵌套；数组、子路径表、更
 *   深嵌套一律视为未知、不预置；
 * - Node 语义入口必须真实存在且可 require，否则跳过；
 * - 解析失败（含 Bun 的进程内负缓存）不重试、不预置；
 * - Node 语义入口以本模块（loader）上下文加载，其依赖沿 node_modules
 *   链解析——提升（hoisted）布局下与 Node 行为一致，嵌套副本布局为
 *   已知近似；
 * - 单进程遍历的包目录数设上限，防御病态巨型依赖树拖慢启动。
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { Logger } from "@koishi-ce/core";

const logger = new Logger("app");

/** 依赖树遍历覆盖的清单字段（devDependencies 不在运行时 require 链上） */
const dependencyFields = [
	"dependencies",
	"peerDependencies",
	"optionalDependencies",
] as const;

/**
 * Node require 语义下的 exports 条件集。条件匹配按 exports 对象的键序
 * 取首个命中（与 Node 一致），"types" / "bun" / "workerd" / "import"
 * 等键不在集合内、自然跳过。
 */
const nodeRequireConditions = ["require", "node", "default"];

/** 单进程遍历的包目录上限：超出后停止深入，防御病态依赖树拖慢启动 */
const maxVisited = 500;

const isWindows = process.platform === "win32";

/** 路径归一（win32 大小写不敏感）用于集合与等值比较 */
function normalizePath(path: string): string {
	return isWindows ? path.toLowerCase() : path;
}

/** 参与遍历与判定的包清单字段（形态宽松，读取失败即放弃分析） */
export interface Manifest {
	main?: unknown;
	exports?: unknown;
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
}

/** 进程级记忆化：已遍历的包目录（归一化） */
const visited = new Set<string>();
/** 已预置种子的 require.cache 键（归一化） */
const seeded = new Set<string>();

/** 读取包清单，任何失败均视为不可分析 */
function readManifest(dir: string): Manifest | undefined {
	try {
		return JSON.parse(
			readFileSync(join(dir, "package.json"), "utf8"),
		) as Manifest;
	} catch {
		return undefined;
	}
}

/**
 * 在 exports 条件表中按 Node require 条件集取首个命中的相对目标。
 * 仅识别字符串目标；命中键的值仍为对象/数组等复杂形态时视为未知。
 */
function resolveExportTarget(exportsField: unknown): string | undefined {
	if (typeof exportsField !== "object" || exportsField === null) {
		return undefined;
	}
	if (Array.isArray(exportsField)) return undefined;
	const record = exportsField as Record<string, unknown>;
	let map: Record<string, unknown>;
	if ("." in record) {
		const dot = record["."];
		if (typeof dot === "string") return dot;
		if (typeof dot !== "object" || dot === null || Array.isArray(dot)) {
			return undefined;
		}
		map = dot as Record<string, unknown>;
	} else {
		// 无 "." 键：存在子路径键则主入口缺失；否则整体视作条件表
		if (Object.keys(record).some((key) => key.startsWith("."))) {
			return undefined;
		}
		map = record;
	}
	for (const key of Object.keys(map)) {
		if (!nodeRequireConditions.includes(key)) continue;
		const value = map[key];
		return typeof value === "string" ? value : undefined;
	}
	return undefined;
}

/**
 * 按 Node require 语义计算包主入口的绝对路径：exports 存在时按
 * require / node / default 条件序解析 "."（无法识别的形态返回
 * undefined）；无 exports 时回落 main。只做路径计算，不校验存在性。
 */
export function nodeRequireEntry(
	manifest: Manifest,
	pkgDir: string,
): string | undefined {
	let target: string | undefined;
	if (manifest.exports === undefined || manifest.exports === null) {
		if (typeof manifest.main !== "string") return undefined;
		target = manifest.main;
	} else {
		target = resolveExportTarget(manifest.exports);
	}
	if (!target) return undefined;
	return join(pkgDir, target);
}

/** 沿 node_modules 链向上探测包目录（纯 fs，不触碰解析 API 及其负缓存） */
function resolvePackageDir(name: string, from: string): string | undefined {
	let dir = from;
	for (;;) {
		const candidate = join(dir, "node_modules", name);
		if (existsSync(join(candidate, "package.json"))) return candidate;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

/** 自入口文件向上找最近的 package.json 所在目录（无清单则不处理） */
function findPackageRoot(entryFile: string): string | undefined {
	let dir = dirname(entryFile);
	for (;;) {
		if (existsSync(join(dir, "package.json"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

/**
 * 对单个依赖判定分歧并预置种子：Bun require 实际命中入口
 * （require.resolve 的 paths 形态即消费方 require 的解析结果与缓存键）
 * 若异于 Node require 语义入口，则把后者的加载结果放到前者的键上。
 */
function trySeed(spec: string, consumerDir: string, depDir: string): void {
	const manifest = readManifest(depDir);
	if (!manifest) return;
	const nodeEntry = nodeRequireEntry(manifest, depDir);
	// Node 语义入口未知（形态无法识别）或不存在：没有可信基准，不预置
	if (!nodeEntry || !existsSync(nodeEntry)) return;
	let bunEntry: string;
	try {
		bunEntry = require.resolve(spec, { paths: [consumerDir] });
	} catch {
		return;
	}
	const key = normalizePath(bunEntry);
	if (seeded.has(key)) return;
	if (key === normalizePath(nodeEntry)) return;
	let exports: unknown;
	try {
		exports = require(nodeEntry);
	} catch {
		// Node 语义入口自身加载失败：宁可不修，不能把失败扩散到消费方
		return;
	}
	const entry = {
		exports,
		filename: bunEntry,
		id: bunEntry,
		loaded: true,
		children: [],
	};
	require.cache[bunEntry] = entry as unknown as (typeof require.cache)[string];
	seeded.add(key);
	logger.debug(
		"seeded cjs interop for %c (%s -> %s)",
		spec,
		bunEntry,
		nodeEntry,
	);
	// 符号链接布局下部分上下文可能以 realpath 为缓存键，补一份等价种子
	try {
		const real = realpathSync(bunEntry);
		if (real !== bunEntry && !(real in require.cache)) {
			require.cache[real] = entry as unknown as (typeof require.cache)[string];
		}
	} catch {}
}

/** 自包目录遍历依赖树（进程内按包目录记忆化），逐依赖尝试种子预置 */
function walkTree(pkgDir: string): void {
	if (visited.size >= maxVisited) return;
	const memo = normalizePath(pkgDir);
	if (visited.has(memo)) return;
	visited.add(memo);
	const manifest = readManifest(pkgDir);
	if (!manifest) return;
	for (const field of dependencyFields) {
		const deps = manifest[field];
		if (!deps) continue;
		for (const spec of Object.keys(deps)) {
			// 类型包不在运行时 require 链上
			if (spec.startsWith("@types/")) continue;
			const depDir = resolvePackageDir(spec, pkgDir);
			// 未安装（含缺失的可选依赖）：跳过，绝不触发解析 API
			if (!depDir) continue;
			trySeed(spec, pkgDir, depDir);
			walkTree(depDir);
		}
	}
}

/**
 * 加载插件入口前预置 CJS interop 种子：自插件包起遍历依赖树，修正
 * Bun require 因 "bun" 导出条件命中 ESM 入口造成的 interop 分歧。
 * 幂等（进程内记忆化）；无分歧时零副作用。
 */
export function seedCjsInterop(entryFile: string): void {
	const root = findPackageRoot(entryFile);
	if (root) walkTree(root);
}
