/**
 * `@koishi-ce/core` 包的入口文件。
 *
 * 这里只做统一的再导出（re-export），将框架各子模块的公开 API 汇总到同一个入口：
 * - `@koishi-ce/utils`：通用工具函数（sleep、defineProperty 等）。
 * - `minato`：ORM 库，数据库操作能力的底层来源。
 * - 本包内的 `command` / `context` / `database` / `filter` / `i18n` / `middleware` /
 *   `permission` / `schema` / `session` 各子模块。
 *
 * 使用方（插件、loader 等）只需 `import { Context, ... } from "@koishi-ce/core"`
 * 即可拿到全部核心类型与实现，无需关心内部目录拆分。
 */
import { version } from "../package.json";

export * from "@koishi-ce/utils";
export * from "minato";
export * from "./command";
export * from "./context";
export type { Tables, Types } from "./database";
export * from "./database";
export * from "./filter";
export * from "./i18n";
export * from "./middleware";
export * from "./permission";
export * from "./schema";
export * from "./session";

export { version };
