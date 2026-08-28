/**
 * @file 市场条目的排序(market 域)。
 *
 * sort: 前缀选择排序器(default=搜索相关度/recommend=推荐分/download/created/
 * updated),-asc/-desc 后缀控制方向;default 排序按搜索分 × 市场排名分,
 * recommend 按 getRecommendScore 六维加权并回退到下载量/更新时间比较。
 */

import type { SearchObject } from "@koishi-ce/registry";
import type { Dict } from "cosmokit";
import type { MarketConfig } from "./context";
import { compareRecommendFallback, getRecommendScore } from "./recommend";
import {
	getSearchIndex,
	getSearchScoreByIndex,
	getSearchWords,
} from "./similarity";

interface Comparator {
	icon: string;
	hidden?: boolean;
	compare?(
		a: SearchObject,
		b: SearchObject,
		words: string[],
		config?: MarketConfig,
	): number;
}

export const comparators: Dict<Comparator> = {
	default: {
		icon: "solid:all",
		compare: (a, b, words) => {
			const searchWords = getSearchWords(words);
			const now = Date.now();
			const delta =
				getSearchScoreByIndex(getSearchIndex(b), searchWords, now) -
				getSearchScoreByIndex(getSearchIndex(a), searchWords, now);
			return delta || b.updatedAt.localeCompare(a.updatedAt);
		},
	},
	recommend: {
		icon: "award",
	},
	download: {
		icon: "download",
		compare: (a, b) =>
			(b.downloads?.lastMonth ?? 0) - (a.downloads?.lastMonth ?? 0),
	},
	created: {
		icon: "heart-pulse",
		compare: (a, b) => b.createdAt.localeCompare(a.createdAt),
	},
	updated: {
		icon: "tag",
		compare: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
	},
};

function getSortConfig(words: string[]) {
	for (let word of words) {
		if (!word.startsWith("sort:")) continue;
		let order = 1;
		if (word.endsWith("-asc")) {
			order = -1;
			word = word.slice(0, -4);
		} else if (word.endsWith("-desc")) {
			word = word.slice(0, -5);
		}
		const key = word.slice(5);
		if (comparators[key]) return { key, order };
	}
	return { key: "default", order: 1 };
}

function sortRecommendMarket(
	market: SearchObject[],
	order: number,
	config?: MarketConfig,
) {
	const now = Date.now();
	return market
		.map((data) => ({
			data,
			index: getSearchIndex(data),
		}))
		.map((item) => ({
			...item,
			score: getRecommendScore(item.data, item.index, config, now),
		}))
		.sort((a, b) => {
			const delta = b.score - a.score;
			return (delta || compareRecommendFallback(a.data, b.data)) * order;
		})
		.map((item) => item.data);
}

function sortMarket(
	market: SearchObject[],
	words: string[],
	config?: MarketConfig,
) {
	const { key, order } = getSortConfig(words);
	if (key === "recommend") return sortRecommendMarket(market, order, config);
	if (key !== "default") {
		const comparator = comparators[key];
		return market
			.slice()
			.sort((a, b) => comparator.compare!(a, b, words, config) * order);
	}
	const searchWords = getSearchWords(words);
	const now = Date.now();
	return market
		.map((data) => ({
			data,
			index: getSearchIndex(data),
		}))
		.map((item) => ({
			...item,
			score: getSearchScoreByIndex(item.index, searchWords, now),
		}))
		.sort((a, b) => {
			const delta = b.score - a.score;
			return (
				(delta || b.index.updatedAt.localeCompare(a.index.updatedAt)) * order
			);
		})
		.map((item) => item.data);
}

export function getSortedPrepared(
	market: SearchObject[],
	words: string[],
	config?: MarketConfig,
) {
	return sortMarket(market, words, config);
}
