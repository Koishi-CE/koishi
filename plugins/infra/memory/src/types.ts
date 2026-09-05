// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import type { Dict } from "cosmokit";

/** 自增主键计数元数据（挂在 _store._fields，与表数据同住）。 */
export interface AutoIncMeta {
	table: string;
	field: string;
	autoInc: number;
}

/** 内存库容器：每个表一份数组，_fields 键另存自增元数据。 */
export type MemoryStore = Record<string, Dict[]> & {
	_fields: AutoIncMeta[];
};
