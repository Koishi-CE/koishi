// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * Loader 公共出口：聚合类型定义、抽象基类、格式表与工具函数。
 *
 * 本文件是 package.json 中 `.` 入口 browser 条件与 `./shared` 子路径的
 * 实现体，仅包含与运行环境无关的部分（不触碰文件系统与序列化细节）；
 * 浏览器侧消费者需自行实现基类声明的平台缝隙。具体实现见各子模块。
 */

export { extensions } from "./base/config-file.ts";
export { default, Loader } from "./base/index.ts";
export type {
	LoaderScope,
	SharedData,
	StartMessage,
} from "./base/types.ts";
export { unwrapExports } from "./base/utils.ts";
