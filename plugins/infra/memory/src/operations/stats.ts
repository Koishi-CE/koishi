// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/** 规模统计：逐表行数清点（内存库无体积概念，size 恒 0）。 */
import { mapValues } from "cosmokit";
import type { MemoryDriver } from "../index.ts";

export function stats(driver: MemoryDriver) {
	return {
		tables: mapValues(driver._store, (rows, name) => ({
			name,
			count: rows.length,
			size: 0,
		})),
		size: 0,
	};
}
