// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 依赖页的分组 / 过滤 / 计数视图纯函数。
 *
 * 分组顺序(重要状态在前,普通已安装垫底)与过滤搜索判定集中在此,
 * 页面壳只做组装;徽标计数与分组列表从同一批 items 派生,保证不同步
 * 的问题在此源头杜绝。
 */
import {
	getShortName,
	type ItemKind,
} from "./dependency-helpers.ts";

/** 过滤下拉的选项 key(各分类 + all)。 */
export type FilterKey = "all" | ItemKind;

/** 单个依赖条目的视图模型(卡片与计数的最小消费面)。 */
export interface DependencyItem {
	name: string;
	kind: ItemKind;
	/** 被忽略规则压制(卡片附「已忽略」徽标) */
	ignored: boolean;
	/** registry 元数据尚在拉取(工具栏加载中计数的来源) */
	fetching: boolean;
}

/** 展示分组:分类 key + 成员列表。 */
export interface DependencyGroup {
	key: ItemKind;
	items: DependencyItem[];
}

/** 分组展示顺序(重要状态在前,普通已安装垫底)。 */
export const GROUP_ORDER: readonly ItemKind[] = [
	"pending",
	"local",
	"alias",
	"invalid",
	"error",
	"updatable",
	"installed",
];

/** 汇总计数:各分类计数 + 加载中 + 总数(过滤前的全集)。 */
export interface GroupSummary {
	total: number;
	fetching: number;
	pending: number;
	local: number;
	alias: number;
	invalid: number;
	error: number;
	updatable: number;
	installed: number;
}

/** 判定条目是否命中过滤项:all 全收,其余按分类。 */
function matchesFilter(
	item: DependencyItem,
	filter: FilterKey,
): boolean {
	if (filter === "all") return true;
	return item.kind === filter;
}

/** 判定条目是否命中搜索词(全名与短名皆可命中)。 */
function matchesKeyword(
	item: DependencyItem,
	word: string,
): boolean {
	if (!word) return true;
	if (item.name.toLowerCase().includes(word)) return true;
	return getShortName(item.name)
		.toLowerCase()
		.includes(word);
}

/** 过滤 + 搜索后的分组视图:按固定顺序组装并丢弃空分组。 */
export function buildGroups(
	items: readonly DependencyItem[],
	filter: FilterKey,
	keyword: string,
): DependencyGroup[] {
	const word = keyword.trim().toLowerCase();
	const buckets = new Map<ItemKind, DependencyItem[]>();
	for (const item of items) {
		if (!matchesFilter(item, filter)) continue;
		if (!matchesKeyword(item, word)) continue;
		const bucket = buckets.get(item.kind);
		if (bucket) {
			bucket.push(item);
		} else {
			buckets.set(item.kind, [item]);
		}
	}
	return GROUP_ORDER.flatMap((key) => {
		const list = buckets.get(key);
		return list ? [{ key, items: list }] : [];
	});
}

/** 从同一批 items 汇总各分类计数与加载中计数。 */
export function summarize(
	items: readonly DependencyItem[],
): GroupSummary {
	const summary: GroupSummary = {
		total: items.length,
		fetching: 0,
		pending: 0,
		local: 0,
		alias: 0,
		invalid: 0,
		error: 0,
		updatable: 0,
		installed: 0,
	};
	for (const item of items) {
		if (item.fetching) summary.fetching++;
		summary[item.kind]++;
	}
	return summary;
}
