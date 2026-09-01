// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 类型侧与运行时同构：把 `@koishijs/plugin-console` 名字的类型解析指回
 * @koishi-ce/plugin-console（下游项目经 npm alias 消费本包时生效）。
 */
export * from "@koishi-ce/plugin-console";
export { default } from "@koishi-ce/plugin-console";
