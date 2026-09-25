// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

// market 领域模型：徽标、分类与配置注入契约。
// 源自上游 @koishijs/market 4.2.10 的 client/utils.ts，2026-09-25 经用户授权
// 现代化重组，不再逐字对齐上游——上游改动按语义评估移植（见 docs/process/upstream.md）。

import type { SearchObject } from "@koishi-ce/registry";
import type { Dict } from "cosmokit";
import type { InjectionKey } from "vue";

const aWeekAgo = new Date(
	Date.now() - 1000 * 3600 * 24 * 7,
).toISOString();

export interface Badge {
	query: string;
	negate: string;
	hidden?(
		config: MarketConfig,
		type: "card" | "filter",
	): boolean;
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
	if (name && categories.includes(name)) return name;
	return "other";
}

export interface MarketConfig {
	installed?(data: SearchObject): boolean;
	portable?: boolean;
}

export const kConfig = Symbol(
	"market.config",
) as InjectionKey<MarketConfig>;
