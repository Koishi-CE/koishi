// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * loader 内部使用的纯工具函数：导出解包、配置源分离与对象键操作。
 */

import type { Dict } from "@koishi-ce/core";

/**
 * 解包模块导出：优先取 default 导出（兼容 CJS/ESM 与转译产物的形态差异）。
 * 动态模块的导出形态无法静态约束，统一以 unknown 返回，由调用方按需收窄。
 */
export function unwrapExports(module: unknown): unknown {
	const record = module as { default?: unknown } | null | undefined;
	return record?.default || module;
}

/**
 * 将插件的配置源分离为纯配置与元属性两部分。
 * 以 `$` 开头的键（如 $if、$filter）属于元属性，不参与插件配置。
 *
 * @param source 插件配置源
 * @param isGroup 组插件配置保持原对象作为配置体（其内部的 `$` 键随配置整体传递）
 * @returns 二元组 [配置体, 元属性表]
 */
export function separate(
	source: unknown,
	isGroup = false,
): [Dict<unknown>, Dict<unknown>] {
	const config: Dict<unknown> = {};
	const meta: Dict<unknown> = {};
	for (const [key, value] of Object.entries(
		(source ?? {}) as Record<string, unknown>,
	)) {
		if (key.startsWith("$")) {
			meta[key] = value;
		} else {
			config[key] = value;
		}
	}
	return [isGroup ? ((source ?? {}) as Dict<unknown>) : config, meta];
}

/**
 * 将 temp 中的键插入到 object 的指定位置（rest 各键之前），
 * 用于在重命名插件时保持键的相对顺序。
 */
function insertKey(object: Dict<unknown>, temp: Dict<unknown>, rest: string[]) {
	for (const key of rest) {
		temp[key] = object[key];
		delete object[key];
	}
	Object.assign(object, temp);
}

/**
 * 在对象中把 old 键（含 `~` 前缀形态）就地改名为 neo，并保持键的先后顺序。
 * 用于插件卸载时把配置键加上 `~` 前缀（保留配置以便恢复）。
 */
export function rename(
	object: Dict<unknown>,
	old: string,
	neo: string,
	value: unknown,
) {
	const keys = Object.keys(object);
	const index = keys.findIndex((key) => key === old || key === `~${old}`);
	const rest = index < 0 ? [] : keys.slice(index + 1);
	const temp: Dict<unknown> = { [neo]: value };
	delete object[old];
	delete object[`~${old}`];
	insertKey(object, temp, rest);
}
