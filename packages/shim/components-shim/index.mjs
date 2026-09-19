// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 上游包名 `@koishijs/components` 的下游兼容 shim（纯 JS 预编译，
 * 不走根 tsdown 构建）。
 *
 * 下游（非 workspace）项目由 create-koishi-ce 生成，package.json 中以
 * npm alias 钉名：
 *
 *   "@koishijs/components": "npm:@koishi-ce/components-shim@^1.5.22"
 *
 * 与 koishi-shim / console-shim / client-shim 同机制：第三方 webui
 * 插件常直接依赖 `@koishijs/components`（element-plus 系共享组件库，
 * 上游插件模板即把它写进 dependencies），该名字无归属时 Bun 会装下
 * npm 官方组件库，与 @koishi-ce/components 形成双实例（schema 表单/
 * 虚拟列表等组件注册两份，行为不可预期）。Bun 对 npm alias 的满足性
 * 判定看**落盘包的 version**，故本包版本冻结 1.5.x 线（满足 `^1.5`
 * 形态的声明），勿随 changesets bump。
 */
export * from "@koishi-ce/components";
export { default } from "@koishi-ce/components";
