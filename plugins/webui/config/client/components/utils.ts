// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * config 插件浏览器端的共享工具入口（桶模块）。
 *
 * 实现拆分为两个单一职责模块，此处聚合再导出并承载浏览器端的
 * 服务 / 事件类型声明，各组件的导入路径保持不变：
 * - env-info.ts：由 store.packages 派生的依赖环境信息（envMap）；
 * - tree.ts：由 store.config 派生的配置树视图与共享响应式状态。
 *
 * Services / Events 的类型增强以 node 侧声明为唯一源头（经 lib 产物 d.ts
 * 与基座接线文件进入浏览器类型程序）；manager/* 事件签名以
 * src/shared/console-events.ts 为唯一权威定义，经下方 type-only import
 * 拉入本端类型程序完成声明合并（该文件不在 config 的 lib 产物入口链上）。
 */

export * from "./env-info.ts";
export * from "./tree.ts";

import type {} from "../../src/shared/console-events.ts";
