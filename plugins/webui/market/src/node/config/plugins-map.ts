import type { Dict } from "@koishi-ce/koishi";

/** loader 插件配置表（plugins 字段的扁平映射）。 */
export type PluginConfigMap = Dict<unknown>;

/** 在插件配置表中查找指定短名的配置键（不递归 group；处理 $ 元键与 ~ 禁用前缀）。 */
export function findPluginConfigKey(
	plugins: unknown,
	shortname: string,
): string | undefined {
	for (const key in (plugins as PluginConfigMap) ?? {}) {
		if (key.startsWith("$")) continue;
		const prefix = key.split(":", 1)[0]!;
		const name = prefix.replace(/^~/, "");
		if (name === shortname) return key;
	}
	return undefined;
}

/** 递归查找：配置表中是否存在指定短名的配置（含 group 嵌套）。 */
export function hasPluginConfigInTree(
	plugins: unknown,
	shortname: string,
): boolean {
	if (findPluginConfigKey(plugins, shortname) !== undefined) return true;
	for (const key in (plugins as PluginConfigMap) ?? {}) {
		if (key.startsWith("$")) continue;
		const name = key.split(":", 1)[0]!.replace(/^~/, "");
		if (
			name === "group" &&
			hasPluginConfigInTree((plugins as PluginConfigMap)[key], shortname)
		)
			return true;
	}
	return false;
}
