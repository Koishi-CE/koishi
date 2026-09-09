// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

// 自上游 @koishijs/market 4.2.10 vendor 而来的市场逻辑层与图标层入口。
// 上游入口同时导出的四个视图组件（filter / list / package / search）
// 已被本仓 client/market/ 的本地化 fork 取代，此处仅保留本插件实际
// 消费的 MarketIcon 与 utils 逻辑面。

export { default as MarketIcon } from "./icons";
export * from "./utils";
