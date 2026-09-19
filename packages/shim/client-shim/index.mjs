// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 上游包名 `@koishijs/client` 的下游兼容 shim（纯 JS 预编译，
 * 不走根 tsdown 构建）。
 *
 * 下游（非 workspace）项目由 create-koishi-ce 生成，package.json 中以
 * npm alias 钉名：
 *
 *   "@koishijs/client": "npm:@koishi-ce/client-shim@^5.30.11"
 *
 * 与 koishi-shim / console-shim 同机制：第三方 webui 插件常把
 * `@koishijs/client` 写进 dependencies 或 peerDependencies（并非只有
 * peer 一种形态——koishi-plugin-adapter-napuketto 即写进 dependencies），
 * 该名字无归属时 Bun 会装下 npm 官方 client，并连带其硬依赖
 * `@koishijs/components` 与官方 console 全家桶，与 @koishi-ce/client
 * 形成双实例。Bun 对 npm alias 的满足性判定看**落盘包的 version**，
 * 故本包版本冻结 5.30.x 线（满足 `^5.x` 形态的声明），勿随
 * changesets bump。
 */
export * from "@koishi-ce/client";
export { default } from "@koishi-ce/client";
