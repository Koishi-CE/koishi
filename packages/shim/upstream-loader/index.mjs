// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 上游包名 `@koishijs/loader` 的兼容 shim（纯 JS 预编译，不走根 tsdown
 * 构建）。
 *
 * @koishi-ce/plugin-config 与 plugin-hmr 的 peerDependencies 刻意声明
 * 上游名 `@koishijs/loader ^4.6.11`（见 AGENTS.md 硬性约束）。没有本
 * shim 时，bun install 会因该 peer 无归属而自动装下 npm 官方
 * @koishijs/loader（其默认导出的 Loader 与 @koishi-ce/loader 是两份实
 * 现，且连带 dotenv / js-yaml / ns-require 全家桶）；本 shim 让这个名
 * 字有唯一归属：
 *
 * - 根 package.json 声明 `"@koishijs/loader": "workspace:*"`，Bun 的
 *   peer 自动安装发现该名已被满足，不再拉入官方包；
 * - 上游形态的 `require("@koishijs/loader")` 解析到本 shim，re-export
 *   的正是 @koishi-ce/loader（默认导出 NodeLoader、命名导出 Loader），
 *   模块实例全局唯一。
 *
 * 版本号刻意为 4.6.11（对齐上游 loader 4.6.x 线），用于满足 `^4.6.11`
 * 形态的 peer 范围；勿改为本仓 1.x 基线版本。
 */
export * from "@koishi-ce/loader";
export { default } from "@koishi-ce/loader";
