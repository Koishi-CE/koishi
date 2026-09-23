// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 宿主全局词典的装载与按路径摘取工具。
 *
 * 独立成模块的原因：setting / theme 等服务在构造 schema 时需要
 * pickMessages，而 i18n 服务又依赖 setting 的 useConfig——若词典
 * 工具留在 i18n.ts 会构成 i18n ↔ setting 循环依赖。词典数据不依赖
 * 任何服务，先于此拆分可用。
 */
import { type Dict, valueMap } from "cosmokit";
import deDE from "../locales/de-DE.yml";
import enUS from "../locales/en-US.yml";
import frFR from "../locales/fr-FR.yml";
import jaJP from "../locales/ja-JP.yml";
import ruRU from "../locales/ru-RU.yml";
import zhCN from "../locales/zh-CN.yml";
import zhTW from "../locales/zh-TW.yml";

/** 宿主自身的全局词典：随服务启动注入，键结构见 client/locales/zh-CN.yml */
export const localeMessages: Dict<Dict> = {
	"de-DE": deDE,
	"en-US": enUS,
	"fr-FR": frFR,
	"ja-JP": jaJP,
	"ru-RU": ruRU,
	"zh-CN": zhCN,
	"zh-TW": zhTW,
};

/**
 * 从一组 `{ locale: 词典 }` 映射中按路径摘取各语种的同一子树，
 * 构造 Schemastery `.i18n()` 的入参形态（`{ locale: 子树 }`）。
 * 宿主与扩展的 schema 词典均可经此摘取；yaml 为动态数据，
 * 收窄集中在这一处。
 */
export function pickFrom(
	messages: Dict<unknown>,
	...path: string[]
): Dict {
	return valueMap(messages, (data) => {
		let node: unknown = data;
		for (const key of path) {
			node = (node as Dict<unknown> | undefined)?.[key];
		}
		return node;
	});
}

/**
 * 从宿主词典中按路径摘取各语种的同一子树（`pickFrom` 的宿主词典
 * 专用便捷形式），叶节点上亦可取得 `Dict<string>`（const 选项的
 * 显示名直接传 description）。
 */
export function pickMessages<T = unknown>(
	...path: string[]
): Dict<T> {
	return pickFrom(localeMessages, ...path) as Dict<T>;
}
