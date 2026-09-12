// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { join, resolve } from "node:path";

/** 仓库根目录（本脚本位于 tooling/sandbox/ 下）。 */
export const ROOT = resolve(
	import.meta.dirname,
	"..",
	"..",
);

/** 脚手架内置模板目录（沙盒的 koishi.yml 等基线从这里复用）。 */
export const TEMPLATE_DIR = join(
	ROOT,
	"apps/koishi-create/src/template",
);

/** 沙盒目录的身份标记文件：无此文件的目录一律拒绝处理。 */
export const MARKER = ".koishi-ce-sandbox.json";

/** 身份标记的 generator 取值；旧版单文件时代的 "tooling/sandbox.ts" 同样被识别。 */
export const GENERATOR = "tooling/sandbox";

/** 默认落点：工作区同级目录（不在仓库内部，天然隔离）。 */
export const DEFAULT_TARGET = resolve(
	ROOT,
	"..",
	"koishi-ce-sandbox",
);

/** 参与 junction 链接的包作用域（create-koishi-ce 等非 CE 作用域工具跳过）。 */
export const SCOPE = "@koishi-ce/";

/** 极简 ANSI 着色（保持零依赖，不引 picocolors）。 */
export const red = (text: string) =>
	`\x1b[31m${text}\x1b[39m`;
export const green = (text: string) =>
	`\x1b[32m${text}\x1b[39m`;
export const yellow = (text: string) =>
	`\x1b[33m${text}\x1b[39m`;
export const dim = (text: string) =>
	`\x1b[2m${text}\x1b[39m`;
