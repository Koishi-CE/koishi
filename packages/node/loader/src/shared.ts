/**
 * Loader 公共出口：聚合类型定义、抽象基类与工具函数。
 *
 * 本文件维持 `@koishi-ce/loader/shared` 子路径与 package.json 中 browser
 * 构建条件的历史兼容入口角色；具体实现见各子模块（base / types / utils）。
 */

export { default, Loader } from "./base";
export type { LoaderScope, StartMessage } from "./types";
export { unwrapExports } from "./utils";
