/**
 * @file 市场目录数据:徽章表、分类表与合包条目判定(market 域)。
 *
 * 纯数据/判定层,被搜索打分(similarity)、排序(sort)、过滤(filter)
 * 与市场页组件消费;不依赖其他 market 子模块。
 */

import type { SearchObject } from "@koishi-ce/registry";
import type { Dict } from "cosmokit";
import { hasBundleKeyword, isBundlePackageName } from "../../src/shared/bundle";
import type { MarketConfig } from "./context";

export function isBundleSearchObject(data: SearchObject) {
	return (
		isBundlePackageName(data.package.name) ||
		hasBundleKeyword(data.package.keywords)
	);
}

export function canInstallBundleSearchObject(data: SearchObject) {
	return isBundleSearchObject(data);
}

const aWeekAgo = new Date(Date.now() - 1000 * 3600 * 24 * 7).toISOString();

export interface Badge {
	query: string;
	negate: string;
	icon?: string;
	hidden?(config: MarketConfig, type: "card" | "filter"): boolean;
}

export const badges: Dict<Badge> = {
	installed: {
		query: "is:installed",
		negate: "not:installed",
		hidden(config, type) {
			return !config.installed || type === "card";
		},
	},
	verified: {
		query: "is:verified",
		negate: "not:verified",
	},
	insecure: {
		query: "is:insecure",
		negate: "not:insecure",
	},
	preview: {
		query: "is:preview",
		negate: "not:preview",
	},
	portable: {
		query: "is:portable",
		negate: "not:portable",
		hidden(config, type) {
			return !config.portable || type === "card";
		},
	},
	bundle: {
		query: "is:bundle",
		negate: "not:bundle",
		icon: "file-archive",
	},
	newborn: {
		query: `created:>${aWeekAgo}`,
		negate: `created:<${aWeekAgo}`,
	},
};

export const categories = [
	"adapter",
	"general",
	"extension",
	"webui",
	"manage",
	"preset",
	"image",
	"media",
	"tool",
	"life",
	"ai",
	"meme",
	"game",
	"gametool",
];

export function resolveCategory(name?: string) {
	if (categories.includes(name!)) return name;
	return "other";
}
