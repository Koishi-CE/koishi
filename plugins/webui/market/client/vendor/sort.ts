// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

// 排序域：比较器族与综合排序（搜索词相似度加权 + sort: 修饰词解析）。
// 源自上游 @koishijs/market 4.2.10 的 client/utils.ts，2026-09-25 经用户授权
// 现代化重组，不再逐字对齐上游——上游改动按语义评估移植（见 docs/process/upstream.md）。

import type { SearchObject } from "@koishi-ce/registry";
import type { Dict } from "cosmokit";
import { getSimilarity } from "./search.ts";

export interface Comparator {
	icon: string;
	hidden?: boolean;
	compare(
		a: SearchObject,
		b: SearchObject,
		words: string[],
	): number;
}

function getSimRating(data: SearchObject, words: string[]) {
	words = words.filter((w) => w && !w.includes(":"));
	if (!words.length) return data.rating;
	let weight = 0;
	for (const word of words) {
		const similarity = getSimilarity(data, word);
		if (!similarity) return 0;
		weight += similarity;
	}
	return data.rating * weight;
}

export const comparators: Dict<Comparator> = {
	default: {
		icon: "solid:all",
		compare: (a, b, words) =>
			getSimRating(b, words) - getSimRating(a, words),
	},
	rating: {
		icon: "star-full",
		compare: (a, b) => b.rating - a.rating,
	},
	download: {
		icon: "download",
		compare: (a, b) =>
			(b.downloads?.lastMonth ?? 0) -
			(a.downloads?.lastMonth ?? 0),
	},
	created: {
		icon: "heart-pulse",
		compare: (a, b) =>
			b.createdAt.localeCompare(a.createdAt),
	},
	updated: {
		icon: "tag",
		compare: (a, b) =>
			b.updatedAt.localeCompare(a.updatedAt),
	},
};

export function getSorted(
	market: SearchObject[],
	words: string[],
) {
	return market
		?.slice()
		.filter((data) => {
			return (
				(!data.manifest?.hidden ||
					words.includes("show:hidden")) &&
				(!data.deprecated ||
					words.includes("show:deprecated"))
			);
		})
		.sort((a, b) => {
			for (let word of words) {
				if (!word.startsWith("sort:")) continue;
				let order = 1;
				if (word.endsWith("-asc")) {
					order = -1;
					word = word.slice(0, -4);
				} else if (word.endsWith("-desc")) {
					word = word.slice(0, -5);
				}
				const comparator = comparators[word.slice(5)];
				if (comparator)
					return comparator.compare(a, b, words) * order;
			}
			return (
				comparators["default"]?.compare(a, b, words) ?? 0
			);
		});
}
