// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 类型侧与运行时同构：把 `@koishijs/components` 名字的类型解析指回
 * @koishi-ce/components（下游项目经 npm alias 消费本包时生效）。
 */
export * from "@koishi-ce/components";
export { default } from "@koishi-ce/components";
