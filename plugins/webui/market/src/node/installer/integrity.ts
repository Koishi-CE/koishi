// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 安装完整性校验：Bun isolated 布局的增量安装缺陷防御。
 *
 * 背景（2026-09-07 实证）：升级插件时包目录 hash 变化，而其依赖的解析
 * 结果未变，bun 的增量安装跳过新包目录内的依赖链接建立——插件入口（顶层
 * symlink）可加载，内部依赖的 require 却炸 MODULE_NOT_FOUND；此时补跑一次
 * 普通 bun install，bun 按磁盘实际状态检测到包不完整即重建链接（秒级）。
 * 本模块只负责「发现问题」，补救（补装、告警）由 installer 侧完成。
 *
 * 全程只走 existsSync / readFileSync / realpathSync，不触碰解析 API
 * （防父目录快照缓存，与 registry 的 resolvePackageJson 同一纪律）。
 */
import {
	existsSync,
	readFileSync,
	realpathSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Dict } from "@koishi-ce/koishi";
import type { LocalPackage } from "./manifest.ts";

/**
 * 从 fromDir 沿 node_modules 链纯 fs 探测依赖包,命中返回其真实目录。
 * realpath 化是 isolated 布局的关键:顶层条目是 symlink,包的依赖链接
 * 挂在 .bun 真实目录的同级 node_modules,从链接路径向上爬会错误地查
 * 顶层(isolated 不提升传递依赖)。
 */
function probePackage(
	fromDir: string,
	name: string,
): string | undefined {
	let dir = resolve(fromDir);
	for (;;) {
		const manifestPath = join(
			dir,
			"node_modules",
			name,
			"package.json",
		);
		if (existsSync(manifestPath)) {
			try {
				return dirname(realpathSync(manifestPath));
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
 * 从本次安装的包出发递归纯 fs 探测依赖可达性，返回「包: 缺失依赖」描述
 * 列表。peer / optional 依赖由宿主或按需提供不入校验；workspace / alias
 * 等非 semver 声明的落盘名与键名无直接映射，同样跳过。
 *
 * @param root 项目根目录
 * @param deps 依赖增删清单（值为 null 表示卸载该依赖）
 */
export function findMissingDeps(
	root: string,
	deps: Dict<string | null>,
): string[] {
	const problems: string[] = [];
	const visited = new Set<string>();
	const walk = (dir: string, label: string) => {
		if (visited.has(dir)) return;
		visited.add(dir);
		let manifest: LocalPackage;
		try {
			manifest = JSON.parse(
				readFileSync(join(dir, "package.json"), "utf8"),
			) as LocalPackage;
		} catch {
			return;
		}
		for (const [dep, request] of Object.entries(
			manifest.dependencies ?? {},
		)) {
			if (request.includes(":")) continue;
			const depDir = probePackage(dir, dep);
			if (!depDir) {
				problems.push(`${label} 的依赖 ${dep} 未被链接`);
				continue;
			}
			walk(depDir, `${label} → ${dep}`);
		}
	};
	for (const name in deps) {
		const request = deps[name];
		if (!request || request.includes(":")) continue;
		const dir = probePackage(root, name);
		// 顶层包未落盘属于安装失败,由退出码与后续加载告警兜底,
		// 不属于「包已装但链接缺失」的补装场景
		if (!dir) continue;
		walk(dir, name);
	}
	return problems;
}
