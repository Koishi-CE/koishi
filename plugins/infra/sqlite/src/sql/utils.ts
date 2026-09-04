// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/** SQLite 方言的 SQL 片段级共享工具。 */

/** 键列表转反引号包裹的列清单，空值兜底为 `*`（DDL / INSERT 列清单共用）。 */
export function joinKeys(keys?: string[]) {
	return keys?.length ? keys.map((key) => `\`${key}\``).join(", ") : "*";
}
