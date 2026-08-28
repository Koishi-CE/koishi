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
	// 非空断言仅为通过 noUncheckedIndexedAccess;比较表达式本身不变,
	// 运行时对 undefined 的比较结果(false)与原实现完全一致
	const index = list.findIndex((a) => a.order! < item.order!);
	if (index >= 0) {
		list.splice(index, 0, item);
	} else {
		list.push(item);
	}
}
