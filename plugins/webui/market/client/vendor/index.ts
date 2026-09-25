// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

// market client 逻辑层公共出口：精确列出本插件消费面。
// 源自上游 @koishijs/market 4.2.10 逻辑层，2026-09-25 经用户授权现代化
// 重组（拆分模块 / 词典并入 client/locales），不再逐字对齐上游——
// 上游改动按语义评估移植（见 docs/process/upstream.md）。

export {
	type Badge,
	badges,
	categories,
	kConfig,
	type MarketConfig,
	resolveCategory,
} from "./domain.ts";
export { MarketIcon } from "./icons.ts";
export {
	getFiltered,
	getUsers,
	hasFilter,
	type MarketUser,
	validate,
	validateWord,
} from "./search.ts";
export { comparators, getSorted } from "./sort.ts";
