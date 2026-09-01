// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

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
import pkg from "../package.json" with { type: "json" };

const { version } = pkg;

export * from "@koishi-ce/utils";
export * from "minato";
export * from "./command/index.ts";
export * from "./context/index.ts";
export type { Tables, Types } from "./database/index.ts";
export * from "./database/index.ts";
export * from "./filter.ts";
export * from "./i18n/index.ts";
export * from "./middleware/index.ts";
export * from "./permission.ts";
export * from "./schema.ts";
export * from "./session/index.ts";

export { version };
