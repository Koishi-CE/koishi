/**
 * 插件名到模块路径的解析（替代历史依赖 ns-require）。
 *
 * Koishi 插件以短名声明（如 "help"），实际模块是带约定前缀的 npm 包
 * （如 koishi-plugin-help）。本模块按下列规则生成候选说明符，再用 Bun
 * 原生的 Bun.resolveSync 逐个解析，第一个命中的即为目标：
 * - 绝对路径：直接采用；
 * - 相对路径（./ ../）：相对插件目录解析为绝对路径；
 * - 已带约定前缀（@koishi-ce/plugin- / @koishijs/plugin- / koishi-plugin-）：
 *   直接采用；
 * - @scope/name 形式：补全为 @scope/koishi-plugin-name；
 * - 裸短名：本组织 @koishi-ce/plugin-* 优先，其次上游官方
 *   @koishijs/plugin-*，最后社区 koishi-plugin-*。
 */

import { isAbsolute, resolve } from "node:path";

/** 候选前缀：本组织优先，其次上游官方组织，最后社区前缀 */
const prefixes = ["@koishi-ce/plugin-", "@koishijs/plugin-", "koishi-plugin-"];

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
 * 解析插件名为模块的绝对入口路径。
 * 全部候选均解析失败时抛错（由调用方决定如何告警）。
 */
export function resolvePlugin(name: string, baseDir: string): string {
	for (const candidate of pluginCandidates(name, baseDir)) {
		try {
			return Bun.resolveSync(candidate, baseDir);
		} catch {}
	}
	throw new Error(`cannot resolve plugin "${name}"`);
}
