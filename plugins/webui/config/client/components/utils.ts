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
 */
import type { Context, Dict } from "@koishi-ce/koishi";
import type { PackageProvider } from "@koishi-ce/plugin-config";

export * from "./env-info.ts";
export * from "./tree.ts";

// 浏览器端 tsconfig 无 paths,@koishi-ce/plugin-console 解析不到真实模块,
// store 的键与 send 的事件类型均来自 packages/web/client/client/shims.d.ts 的
// 手写环境声明;这里按同名环境声明合并补齐本插件的服务,与服务端
// src/shared/index.ts 对 "@koishi-ce/console" 的声明一一对应。
// manager/* 事件签名以 src/shared/console-events.ts 为唯一权威定义,
// 经下方 type-only import 拉入本端类型程序完成声明合并
import type {} from "../../src/shared/console-events.ts";

declare module "@koishi-ce/plugin-console" {
	namespace Console {
		export interface Services {
			packages: DataService<Dict<PackageProvider.Data>>;
			services: DataService<Dict<number>>;
			config: DataService<Context.Config>;
		}
	}
}
