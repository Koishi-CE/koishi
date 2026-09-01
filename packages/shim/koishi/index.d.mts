// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 类型侧与运行时同构：把 `koishi` 裸名的类型解析指回 @koishi-ce/koishi。
 * 日常开发一律 `import ... from "@koishi-ce/*"`（见 AGENTS.md 硬性约束），
 * 本文件仅在社区包以 `koishi` 裸名被类型程序消费时兜底。
 */
export * from "@koishi-ce/koishi";
