import * as cordis from "cordis";
import { markRaw } from "vue";
import type { Context } from "./context";

export abstract class Service<
	T = unknown,
	C extends Context = Context,
> extends cordis.Service<T, C> {}

export interface Ordered {
	order?: number;
}

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
