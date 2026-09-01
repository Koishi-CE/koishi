// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 类型侧与运行时同构：把 `@koishijs/plugin-console` 名字的类型解析指回
 * @koishi-ce/plugin-console。日常开发一律 `import ... from "@koishi-ce/*"`
 * （见 AGENTS.md 硬性约束），本文件仅在社区包以上游名被类型程序消费时
 * 兜底。
 */
export * from "@koishi-ce/plugin-console";
export { default } from "@koishi-ce/plugin-console";
