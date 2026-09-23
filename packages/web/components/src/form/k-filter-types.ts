// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * k-filter 家族（k-filter / k-filter-expr / k-filter-button）共享的
 * 过滤表达式类型：minato 查询条件的结构化形态与宿主选项。
 */

/** 单条表达式的操作数：[{ $: 实体名 }, 比较值] */
export type Operand = [{ $: string }, unknown];

/** minato 过滤表达式：单条 { [运算符]: 操作数 }，或 $and / $or 逻辑组合 */
export interface FilterExpr {
	$and?: FilterExpr[];
	$or?: FilterExpr[];
	[operator: string]: FilterExpr[] | Operand | undefined;
}

/** 过滤器宿主选项：userFields 声明可选的自定义用户字段（user.* 实体开关） */
export interface FilterOptions {
	userFields?: string[];
}
