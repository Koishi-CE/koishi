// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 上游包名 `@koishijs/core` 的兼容 shim（纯 JS 预编译，不走根 tsdown
 * 构建）。
 *
 * @koishi-ce/loader 的 peerDependencies 刻意精确锁上游名
 * `@koishijs/core 4.18.11`（见 AGENTS.md 硬性约束）。没有本 shim 时，
 * bun install 会因该 peer 无归属而自动装下 npm 官方 @koishijs/core
 * （koishi 4.18 的核心包，连带 cordis / minato / @satorijs 全家桶），
 * 形成第二份 koishi 核心副本——社区插件若以其 require 将破坏 cordis
 * 对象身份；本 shim 让这个名字有唯一归属：
 *
 * - 根 package.json 声明 `"@koishijs/core": "workspace:*"`，Bun 的 peer
 *   自动安装发现该名已被满足，不再拉入官方包；
 * - 社区插件运行时 `require("@koishijs/core")` 解析到本 shim，re-export
 *   的正是 @koishi-ce/core，模块实例全局唯一。
 *
 * 版本号刻意为 4.18.11（loader 的 peer 为精确版本，必须逐字相等），
 * 勿改为本仓 1.x 基线版本。
 */
export * from "@koishi-ce/core";
