// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import * as cordis from "cordis";
import { markRaw } from "vue";
import type { Context } from "./context";

/**
 * 前端服务基类：继承 cordis.Service 并固定为本库的 Context 类型。
 * 各核心服务（action / i18n / loader / router / setting / theme）均由此派生。
 */
export abstract class Service<
	T = unknown,
	C extends Context = Context,
> extends cordis.Service<T, C> {}

/** 可排序项：实现本接口的条目可被 insert() 按 order 插入有序列表 */
export interface Ordered {
	order?: number;
}

/**
 * 按 order 升序将条目插入有序列表（相同 order 的后者排在后面）。
 * 同时 markRaw 标记条目，避免其被 Vue 深度代理。
 */
export function insert<T extends Ordered>(list: T[], item: T) {
	markRaw(item);
	// order 为可选属性：任一侧缺失（undefined）时数值比较结果恒为 false，
	// 与原实现（直接比较）在所有输入下的求值结果一致，这里显式判空以通过严格空检查
	const index = list.findIndex(
		(a) =>
			a.order !== undefined && item.order !== undefined && a.order < item.order,
	);
	if (index >= 0) {
		list.splice(index, 0, item);
	} else {
		list.push(item);
	}
}
