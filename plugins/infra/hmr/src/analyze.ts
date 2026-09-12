// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 纯依赖图分析层：无副作用的算法函数，供 index.ts 的 Watcher 服务调用。
 */

/**
 * 判断模块路径是否位于 node_modules 内。
 * win32 下 Bun 的 require.cache 键是反斜杠路径，字面量 includes
 * 从不命中，node_modules 模块会全量混入依赖图引发误重载
 * upstream: koishijs/koishi#1232
 */
export function isInNodeModules(filename: string): boolean {
	return filename.split(/[\\/]/).includes("node_modules");
}

/**
 * 收集某模块及其全部子依赖的文件路径
 * @param filename 入口模块的绝对路径
 * @param ignored 需要排除的文件路径集合
 * @returns 依赖文件路径集合（不含 node_modules 与 ignored 中的文件）
 */
export function loadDependencies(
	filename: string,
	ignored: Set<string>,
) {
	const dependencies = new Set<string>();
	function traverse({ filename, children }: NodeJS.Module) {
		if (
			ignored.has(filename) ||
			dependencies.has(filename) ||
			isInNodeModules(filename)
		)
			return;
		dependencies.add(filename);
		children.forEach(traverse);
	}
	const module = require.cache[filename];
	if (module) traverse(module);
	return dependencies;
}

/** 沿 require 依赖图自底向上传播：任一子模块 accepted 则本模块 accepted，全部 declined 才 declined */
export function analyzeChanges(
	stashed: Set<string>,
	externals: Set<string>,
): { accepted: Set<string>; declined: Set<string> } {
	/** 尚未定论的待分类文件 */
	const pending: string[] = [];

	const accepted = new Set(stashed);
	const declined = new Set(externals);

	stashed.forEach((filename) => {
		const module = require.cache[filename];
		if (!module) return;
		const { children } = module;
		for (const { filename } of children) {
			if (
				accepted.has(filename) ||
				declined.has(filename) ||
				isInNodeModules(filename)
			)
				continue;
			pending.push(filename);
		}
	});

	while (pending.length) {
		let index = 0,
			hasUpdate = false;
		while (index < pending.length) {
			const filename = pending[index];
			if (filename === undefined) {
				index++;
				continue;
			}
			const module = require.cache[filename];
			if (!module) {
				index++;
				continue;
			}
			const { children } = module;
			let isDeclined = true,
				isAccepted = false;
			for (const { filename } of children) {
				// 忽略已判定为 declined 的子模块
				if (
					declined.has(filename) ||
					isInNodeModules(filename)
				)
					continue;
				if (accepted.has(filename)) {
					// 任一子模块 accepted，则本模块也 accepted
					isAccepted = true;
					break;
				} else {
					// 子模块既非 accepted 也非 declined，需要继续向下分析
					isDeclined = false;
					if (!pending.includes(filename)) {
						hasUpdate = true;
						pending.push(filename);
					}
				}
			}
			if (isAccepted || isDeclined) {
				hasUpdate = true;
				pending.splice(index, 1);
				if (isAccepted) {
					accepted.add(filename);
				} else {
					// 全部子模块 declined，则本模块也 declined
					declined.add(filename);
				}
			} else {
				index++;
			}
		}
		// 一轮下来毫无进展则退出，避免死循环
		if (!hasUpdate) break;
	}

	// 循环结束后仍未定论的文件（如循环依赖）一律视为 declined
	for (const filename of pending) {
		declined.add(filename);
	}

	return { accepted, declined };
}
