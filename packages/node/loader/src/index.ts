/**
 * @koishi-ce/loader 包入口。
 *
 * 默认导出 NodeLoader（Bun/Node 环境实现，见 node/），命名导出平台无关的
 * Loader 抽象基类（见 base/）。目录结构：
 * - base/：运行环境无关的抽象层（基类、类型与符号、配置格式表、
 *   内置 group 插件、应用装配）；
 * - node/：Bun/Node 环境实现（插件解析加载、配置文件 I/O、
 *   env 文件注入、清单迁移）。
 */

export { extensions } from "./base/config-file.ts";
export type { LoaderScope, SharedData, StartMessage } from "./base/types.ts";
export { unwrapExports } from "./base/utils.ts";
export { default, Loader } from "./node/index.ts";
export { pluginCandidates, resolvePlugin } from "./node/resolve.ts";
