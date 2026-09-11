// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import * as cordis from "cordis";
import {
	inject,
	markRaw,
	onBeforeUnmount,
	type Ref,
} from "vue";
import type { Context } from "./context";

/**
 * 前端服务基类：继承 cordis.Service 并固定为本库的 Context 类型。
 * 各核心服务（action / i18n / loader / router / setting / theme）均由此派生。
 */
export abstract class Service<
	T = unknown,
	C extends Context = Context,
> extends cordis.Service<T, C> {}

/**
 * 在组件 setup 中获取与当前组件生命周期绑定的 Context。
 *
 * 实现：从父级注入根 Context，创建一个空的插件 fork，使得返回的
 * 子上下文在组件卸载时（onBeforeUnmount）自动 dispose，从而组件内
 * 通过它注册的副作用（effect / 事件监听等）会随组件销毁被清理。
 */
export function useContext() {
	const parent = inject("cordis") as Context;
	const fork = parent.plugin(() => {});
	onBeforeUnmount(() => fork.dispose());
	return fork.ctx;
}

/**
 * 获取当前扩展（extension）通过 RPC 携带的只读数据。
 * 仅在由 loader 动态加载的扩展组件内可用。
 */
export function useRpc<T>(): Ref<T> {
	const parent = inject("cordis") as Context;
	return parent.extension?.data as Ref<T>;
}

/** 可排序项：实现本接口的条目可被 insert() 按 order 插入有序列表 */
export interface Ordered {
	order?: number;
}

/**
 * 按 order 升序将条目插入有序列表（相同 order 的后者排在后面）。
 * 同时 markRaw 标记条目，避免其被 Vue 深度代理。
 */
export function insert<T extends Ordered>(
	list: T[],
	item: T,
) {
	markRaw(item);
	// order 为可选属性：任一侧缺失（undefined）时数值比较结果恒为 false，
	// 与原实现（直接比较）在所有输入下的求值结果一致，这里显式判空以通过严格空检查
	const index = list.findIndex(
		(a) =>
			a.order !== undefined &&
			item.order !== undefined &&
			a.order < item.order,
	);
	if (index >= 0) {
		list.splice(index, 0, item);
	} else {
		list.push(item);
	}
}
