// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * `@koishi-ce/koishi` 包入口。
 *
 * 本文件专为不使用 CLI 的用户准备：将 core 与 loader 两包的导出合并再分发，
 * 并默认导出 NodeLoader 实现，使开发者可以直接以编程方式启动 Koishi。
 * 结构与上游 koishi 主包入口同构（core + loader 合并再导出）——
 * `packages/shim/koishi-shim` 据此以单一 re-export 兼任 koishi 裸名与
 * `@koishijs/core` / `@koishijs/loader` 三个上游名的下游 alias 目标。
 */

export * from "@koishi-ce/core";
export * from "@koishi-ce/loader";
export { default, Loader } from "@koishi-ce/loader";
