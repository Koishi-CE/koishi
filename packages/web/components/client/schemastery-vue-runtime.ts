// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * "schemastery-vue/client" 虚拟子路径的运行时载体（仅服务于打包器）。
 *
 * 真实包只默认导出 form（即 SchemaBase 本体），没有 SchemaBase 具名导出，
 * 而下游广泛按具名导入使用——本文件在运行时面补齐这一导出。
 *
 * 构建器（packages/web/client 的 src/index.ts 与 scripts/client.ts）把
 * "schemastery-vue/client" 别名到本文件；类型面则由 tsconfig 的 paths
 * 解析到同目录 schemastery-vue-client.ts，两套载体各司其职。
 *
 * 注意：本文件被 components/client/tsconfig.json 显式排除——它引入的
 * schemastery-vue 源码不满足本仓库的超严格编译配置，只允许进入打包
 * 管线，不进入任何类型程序。
 */
export * from "schemastery-vue";
export {
	default,
	default as SchemaBase,
} from "schemastery-vue";
