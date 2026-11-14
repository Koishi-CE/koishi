// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * workspace 包发现与根清单解析的公共底层（checks / release / sandbox 三方
 * 共用）。包发现以根 package.json 的 workspaces 声明为唯一事实源，兼容数组
 * 形态与 Bun catalog 协议强制的 `{ packages }` 对象形态。
 */
import {
	readdirSync,
	readFileSync,
	statSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/** 仓库根目录（本目录位于 tooling/ 下）。 */
export const ROOT = resolve(
	import.meta.dirname,
	"..",
	"..",
);

/** path 分隔符归一为 posix（win32 下文件系统返回反斜杠路径）。 */
export function toPosix(path: string): string {
	return path.split(sep).join("/");
}

/** 读 JSON 文件为对象；缺失 / 畸形 / 非对象 → null。 */
export function readJsonFile(
	path: string,
): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(
			readFileSync(path, "utf8"),
		);
		return parsed !== null &&
			typeof parsed === "object" &&
			!Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

/** 从根清单读 workspaces globs（数组形态与 `{ packages }` 对象形态）。 */
export function readWorkspaceGlobs(root: string): string[] {
	const declared = readJsonFile(
		join(root, "package.json"),
	)?.["workspaces"];
	const list = Array.isArray(declared)
		? declared
		: (declared as { packages?: unknown } | undefined)
				?.packages;
	return Array.isArray(list)
		? list.filter(
				(item): item is string => typeof item === "string",
			)
		: [];
}

/**
 * 枚举 workspaces 声明的全部成员目录（绝对路径，去重，按路径排序）。
 *
 * "字面前缀/*" 单层形态走 readdirSync：Bun.Glob 在 win32 下对「1 段固定
 * 前缀 + 星号再下钻」的 glob 恒返回空集（packages 星号加 package.json 的
 * 写法扫出 0 条，两层固定前缀才正常，1.4.2 实测），文件系统枚举无此怪癖。
 * 其余 glob 形态回退 Bun.Glob 目录扫描（须以对象形态传 cwd，win32 下
 * 位置参数形态恒空），命中的文件路径由消费方的 package.json 检查过滤。
 * 脚手架模板目录（相对路径含 /template/ 段）不是 workspace 包，一律排除。
 */
export function discoverWorkspaceDirs(
	root: string,
): string[] {
	const dirs = new Set<string>();
	for (const glob of readWorkspaceGlobs(root)) {
		// 前缀不含 glob 魔法字符才算字面单层形态（深层 glob 如
		// external 双星通配不能误入 readdirSync 分支）
		const literal = /^([^*?[{]+)\/\*$/.exec(glob);
		if (literal) {
			const base = join(root, literal[1] ?? "");
			let entries: import("node:fs").Dirent[];
			try {
				entries = readdirSync(base, {
					withFileTypes: true,
				});
			} catch (err) {
				// 基准目录不存在（ENOENT）或前缀实为文件（ENOTDIR）：
				// 该 glob 无成员；其余错误（权限等）不吞，防止枚举静默归零
				const code = (err as NodeJS.ErrnoException)?.code;
				if (code === "ENOENT" || code === "ENOTDIR") {
					continue;
				}
				throw err;
			}
			for (const entry of entries) {
				if (entry.isDirectory()) {
					dirs.add(join(base, entry.name));
				}
			}
			continue;
		}
		for (const entry of new Bun.Glob(glob).scanSync({
			cwd: root,
			onlyFiles: false,
		})) {
			// onlyFiles:false 仍会命中文件路径，统一收敛为只返回目录
			const full = resolve(root, entry);
			try {
				if (statSync(full).isDirectory()) {
					dirs.add(full);
				}
			} catch {
				// 扫描与统计之间被删除的条目：跳过
			}
		}
	}
	return [...dirs]
		.filter((dir) => {
			// 脚手架模板目录（路径中任一层叫 template）不是 workspace 包
			const segments = toPosix(relative(root, dir)).split(
				"/",
			);
			return !segments.includes("template");
		})
		.sort();
}

/** 根清单 catalog 定义（catalog 纪律检查与发布改写共同的事实源）。 */
export interface CatalogSpecs {
	/** 默认目录（spec 值 "catalog:" 引用）。 */
	default: Map<string, string>;
	/** 命名目录（spec 值 "catalog:<名>" 引用）。 */
	named: Map<string, Map<string, string>>;
}

/** 从根清单读 catalog 定义（缺失或缺项返回空表；非字符串 spec 忽略）。 */
export function readCatalogSpecs(
	root: string,
): CatalogSpecs {
	const strings = (
		record: Record<string, unknown> | undefined,
	) =>
		new Map(
			Object.entries(record ?? {}).filter(
				(entry): entry is [string, string] =>
					typeof entry[1] === "string",
			),
		);
	const workspaces = (readJsonFile(
		join(root, "package.json"),
	)?.["workspaces"] ?? {}) as {
		catalog?: Record<string, unknown>;
		catalogs?: Record<string, Record<string, unknown>>;
	};
	return {
		default: strings(workspaces.catalog),
		named: new Map(
			Object.entries(workspaces.catalogs ?? {}).map(
				([name, entries]) => [name, strings(entries)],
			),
		),
	};
}
