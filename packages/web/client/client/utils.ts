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
	const index = list.findIndex((a) => a.order < item.order);
	if (index >= 0) {
		list.splice(index, 0, item);
	} else {
		list.push(item);
	}
}
