// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import type { Context, Store } from "@koishi-ce/client";
/**
 * 宿主运行时注入的读取器：组件库自身不依赖 `@koishi-ce/client`
 * 的运行时（避免两包成环），仅依赖宿主启动时注入的两件东西——
 *
 * - 全局数据仓库（store）：由 client 启动时经 provideStore() 喂入；
 * - 根 Context：由宿主 Vue 应用 provide 的 "cordis"（见
 *   packages/web/client/src/context.ts 构造器），useContext() 读取。
 *
 * 两者的类型均以 import type 引用 client（类型边在编译期擦除，运行时
 * 零依赖），模块加载顺序为 client 入口先于任何组件渲染，故 useStore()
 * 在组件与扩展注册的闭包中读取时注入必已完成。
 */
import { inject, onBeforeUnmount } from "vue";

/** 宿主注入的全局数据仓库（client 的 data.ts store，模块级单例） */
let store!: Store;

/**
 * 宿主启动时注入全局数据仓库（client/src/index.ts 顶层调用）。
 * store 本身是响应式单例，此处仅持有引用，不做任何包装。
 */
export function provideStore(value: Store) {
	store = value;
}

/** 读取全局数据仓库（store.schema / store.permissions 等） */
export function useStore(): Store {
	return store;
}

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
