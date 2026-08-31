/**
 * 插件名到模块路径的解析（替代历史依赖 ns-require）。
 *
 * Koishi 插件以短名声明（如 "help"），实际模块是带约定前缀的 npm 包
 * （如 koishi-plugin-help）。本模块按下列规则生成候选说明符，再逐个解析，
 * 第一个命中的即为目标：
 * - 绝对路径：直接采用；
 * - 相对路径（./ ../）：相对插件目录解析为绝对路径；
 * - 已带约定前缀（@koishi-ce/plugin- / @koishijs/plugin- / koishi-plugin-）：
 *   直接采用；
 * - @scope/name 形式：补全为 @scope/koishi-plugin-name；
 * - 裸短名：本组织 @koishi-ce/plugin-* 优先，其次上游官方
 *   @koishijs/plugin-*，最后社区 koishi-plugin-*。
 *
 * 解析顺序：Bun.resolveSync 优先，失败后对裸名候选做纯 fs 兜底（见
 * fsResolvePackage）——插件可能刚被市场装好，而其裸名形态在装包前的
 * 探测中已触发 Bun 的父目录快照缓存（装完仍解析失败），fs 直查不受
 * 快照影响，装完插件后无需重启进程即可加载。
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** 候选前缀：本组织优先，其次上游官方组织，最后社区前缀 */
const prefixes = ["@koishi-ce/plugin-", "@koishijs/plugin-", "koishi-plugin-"];

/**
 * Bun require 语义的 exports 条件序：Bun 会把 exports 的 "bun" 条件
 * 应用在 require 链上（见 interop.ts 的分歧修复），兜底入口计算对其
 * 对齐；其余按 require / node / default 常规序。
 */
const bunRequireConditions = ["bun", "require", "node", "default"];

/** 入口目标补全的扩展名序（对齐 Bun require 的模块解析，含 TS 支持） */
const entryExtensions = ["", ".js", ".cjs", ".mjs", ".ts"];

/** 兜底入口计算所需的清单字段（形态宽松，读取失败即放弃） */
interface EntryManifest {
	main?: unknown;
	module?: unknown;
	exports?: unknown;
}

/**
 * 从清单计算 require 入口的绝对路径（只做路径计算与存在性校验）。
 * exports 为字符串直接采用；条件表仅识别 "." 主入口的扁平与一层嵌套
 * 形态（与 interop.ts 的保守识别口径一致，数组 / 子路径表 / 更深嵌套
 * 一律视为未知返回 undefined，宁可解析失败也不猜错入口）；exports 存
 * 在时 main 无效（Node 语义）；无 exports 时按 main → index.js →
 * module 兜底（Bun require 可直接加载 ESM 入口）。
 */
function resolveEntry(
	pkgDir: string,
	manifest: EntryManifest,
): string | undefined {
	const targets: string[] = [];
	if (manifest.exports !== undefined && manifest.exports !== null) {
		if (typeof manifest.exports === "string") {
			targets.push(manifest.exports);
		} else if (
			typeof manifest.exports === "object" &&
			!Array.isArray(manifest.exports)
		) {
			const record = manifest.exports as Record<string, unknown>;
			let map: Record<string, unknown> | undefined;
			if ("." in record) {
				const dot = record["."];
				if (typeof dot === "string") {
					targets.push(dot);
				} else if (
					typeof dot === "object" &&
					dot !== null &&
					!Array.isArray(dot)
				) {
					map = dot as Record<string, unknown>;
				}
			} else if (!Object.keys(record).some((key) => key.startsWith("."))) {
				// 无 "." 键且无子路径键：整体视作条件表
				map = record;
			}
			if (map) {
				const hit = Object.keys(map).find((key) =>
					bunRequireConditions.includes(key),
				);
				const value = hit === undefined ? undefined : map[hit];
				if (typeof value !== "string") return undefined;
				targets.push(value);
			}
		}
		if (!targets.length) return undefined;
	} else {
		if (typeof manifest.main === "string") targets.push(manifest.main);
		targets.push("index.js");
		if (typeof manifest.module === "string") targets.push(manifest.module);
	}
	for (const target of targets) {
		for (const ext of entryExtensions) {
			const filename = join(pkgDir, target + ext);
			if (existsSync(filename)) return filename;
		}
	}
	return undefined;
}

/**
 * 纯 fs 解析兜底：沿 node_modules 链 existsSync 探测包目录，命中后按
 * manifest 计算 require 入口绝对路径。
 *
 * Bun 的解析器对失败的查找按「父目录快照」做进程内缓存（机制与实证
 * 详见 @koishi-ce/registry 的 resolvePackageJson 注释）：市场安装流程
 * 装包前的探测已把该裸名的解析在本进程内判死，装完仍失败。本兜底只
 * 用 existsSync / readFileSync（真实系统调用，不经过解析缓存），拿到
 * 的入口绝对路径由调用方 require（绝对路径不经过目录查找，不受快照
 * 影响）。命中包目录但清单不可读或入口不可识别 / 不存在时返回
 * undefined（近似 Node「包存在但入口坏」的报错语义，交由上层统一报
 * 无法解析）。
 *
 * 已知边界：兜底只救「插件入口」这一跳，插件内部依赖的裸名解析仍是
 * Bun 运行时行为——若快照已污染且 Bun auto-install 开启，其依赖可能
 * 被从全局缓存拉到错误版本。正常安装流程装包前只走纯 fs 探测
 * （resolvePackageJson / isResidentInCache），不产生任何解析 API 失败，
 * 本兜底实际不会被触发，仅作意外污染源（如装包期间的手动解析）的
 * 纵深防御。
 */
function fsResolvePackage(spec: string, baseDir: string): string | undefined {
	let dir = resolve(baseDir);
	for (;;) {
		const pkgDir = join(dir, "node_modules", spec);
		const manifestPath = join(pkgDir, "package.json");
		if (existsSync(manifestPath)) {
			try {
				const manifest = JSON.parse(
					readFileSync(manifestPath, "utf8"),
				) as EntryManifest;
				return resolveEntry(pkgDir, manifest);
			} catch {
				return undefined;
			}
		}
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

/**
 * 生成插件名的候选模块说明符列表（按解析优先级排序）。
 */
export function pluginCandidates(name: string, baseDir: string): string[] {
	// 绝对路径
	if (isAbsolute(name)) {
		return [name];
	}

	// 相对路径：相对插件目录（baseDir）解析
	if (name.startsWith("./") || name.startsWith("../")) {
		return [resolve(baseDir, name)];
	}

	// 已带约定前缀的完整包名
	if (prefixes.some((prefix) => name.startsWith(prefix))) {
		return [name];
	}

	// @scope/name 形式：为内层名补全社区前缀
	if (name.startsWith("@")) {
		const index = name.indexOf("/");
		if (index < 0) throw new Error(`cannot resolve plugin "${name}"`);
		const scope = name.slice(0, index + 1);
		const inner = name.slice(index + 1);
		return [
			scope +
				(inner.startsWith("koishi-plugin-") ? inner : `koishi-plugin-${inner}`),
		];
	}

	// 裸短名：官方组织优先
	return prefixes.map((prefix) => prefix + name);
}

/**
 * 解析插件名为模块的绝对入口路径：候选依次先 Bun.resolveSync，失败后
 * 对裸名候选做纯 fs 兜底（绝对 / 相对路径候选不经 node_modules 查找，
 * 无需兜底）。全部候选均解析失败时抛错（由调用方决定如何告警）。
 */
export function resolvePlugin(name: string, baseDir: string): string {
	for (const candidate of pluginCandidates(name, baseDir)) {
		try {
			return Bun.resolveSync(candidate, baseDir);
		} catch {}
		if (isAbsolute(candidate)) continue;
		const fallback = fsResolvePackage(candidate, baseDir);
		if (fallback) return fallback;
	}
	throw new Error(`cannot resolve plugin "${name}"`);
}
