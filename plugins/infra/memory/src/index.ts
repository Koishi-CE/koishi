// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import type { Dict } from "cosmokit";
/**
 * 内存数据库驱动（minato 3 / cordis 3 冻结线）。
 *
 * 纯内存实现，无任何持久化——进程退出数据即失。定位是测试替身
 * 与行为基准：单测里与 plugin-mock 配对构成无 IO 的测试基建；
 * SQLite 驱动的对拍测试以本驱动为行为参照。
 *
 * 上游脉络：`@koishijs/plugin-database-memory` 3.7.0（纯 re-export
 * 薄壳）与 `@minatojs/driver-memory` 3.7.0（225 行实现）的文件级
 * 合并——查询求值、排序、分组全部复用 minato 基类的 execute*
 * 系列基建，本包只维护数据存放与各 Driver 抽象方法的内存版
 * 实现；映射关系见 docs/process/upstream.md。
 *
 * 模块划分（src/ 下，对齐 sqlite 驱动的组织方式）：query.ts 为
 * 查询求值核心（table() 的实现：过滤 / join 笛卡尔积 / 分组
 * 聚合）；operations/ 为 Driver 方法实现（crud.ts 数据操作、
 * indexes.ts 索引记账、stats.ts 规模统计）；本类只保留有状态的
 * 部分——store 容器与生命周期，方法一律薄委托。
 *
 * 与上游的刻意差异仅三类：模块拆分（上游为单文件）；导入指向
 * 冻结生态（cosmokit / minato）；本仓代码风格（tab / 双引号 /
 * 行类型 Dict / 无非空断言——上游的 `!` 断言改写为 `as` 转型，
 * 语义等价）。逻辑逐行对齐，含 `catesian` 一名系上游既有拼写
 * （笛卡尔积），保留以求移植对照时 diff 最小。
 */
import { clone } from "cosmokit";
import type { Eval, Selection } from "minato";
import { Driver, z } from "minato";
import * as crud from "./operations/crud.ts";
import * as indexes from "./operations/indexes.ts";
import { stats } from "./operations/stats.ts";
import { executeTable } from "./query.ts";
import type { MemoryStore } from "./types.ts";

/**
 * 驱动本体。本类只保留有状态的部分——store 容器（表数据 +
 * 自增元数据）、索引记账表与（空操作的）生命周期钩子，
 * 求值与数据操作一律薄委托到 query.ts 与 operations/ 下的
 * 实现函数（首参回传 this），对外 API 面与上游单文件形态
 * 保持一致。
 */
export class MemoryDriver extends Driver<MemoryDriver.Config> {
	static override name = "memory";

	static Config: z<MemoryDriver.Config> = z.object({});

	_store: MemoryStore = { _fields: [] };

	_indexes: Record<string, Record<string, Driver.Index>> =
		{};

	// ---- 生命周期：内存库无 IO，均为空操作（$save 为上游保留挂点） ----

	async prepare(_name: string) {}

	async start() {}

	async $save(_name: string) {}

	async stop() {}

	// ---- 查询求值与 Driver 抽象方法的薄委托 ----

	table(
		sel:
			| string
			| Selection.Immutable
			| Record<string, string | Selection.Immutable>,
		env: Dict = {},
	): Dict[] {
		return executeTable(this, sel, env);
	}

	async drop(table: string) {
		delete this._store[table];
	}

	async dropAll() {
		this._store = { _fields: [] };
	}

	async stats() {
		return stats(this);
	}

	async get(sel: Selection.Immutable) {
		return crud.get(this, sel);
	}

	async eval(sel: Selection.Immutable, expr: Eval.Expr) {
		return crud.evaluate(this, sel, expr);
	}

	async set(sel: Selection.Mutable, data: object) {
		return crud.set(this, sel, data);
	}

	async remove(sel: Selection.Mutable) {
		return crud.remove(this, sel);
	}

	async create(sel: Selection.Mutable, data: Dict) {
		return crud.create(this, sel, data);
	}

	async upsert(
		sel: Selection.Mutable,
		data: Dict[],
		keys: string[],
	) {
		return crud.upsert(this, sel, data, keys);
	}

	executeSelection(
		sel: Selection.Immutable,
		env: Dict | Dict[] = {},
	) {
		return crud.executeSelection(this, sel, env);
	}

	async withTransaction(callback: () => Promise<void>) {
		const data = clone(this._store);
		await callback().catch((e) => {
			this._store = data;
			throw e;
		});
	}

	async getIndexes(table: string) {
		return indexes.getIndexes(this, table);
	}

	async createIndex(table: string, index: Driver.Index) {
		return indexes.createIndex(this, table, index);
	}

	async dropIndex(table: string, name: string) {
		return indexes.dropIndex(this, table, name);
	}
}

export namespace MemoryDriver {
	// biome-ignore lint/suspicious/noEmptyInterface: 与上游保持一致，声明可被下游扩展的空配置
	export interface Config {}
}

export default MemoryDriver;
