// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { type App, type Component, defineComponent, h } from "vue";
import { useContext } from "../context";

/** 插槽条目的基础形状：参与排序的组件 */
export interface SlotItem {
	order?: number;
	component: Component;
}

/**
 * 通过 `ctx.slot()` 注册的外部插槽视图。
 * type 为插槽名（layout / status / global 等）。
 */
export interface SlotOptions extends SlotItem {
	type: string;
	/** @deprecated */
	when?: () => boolean;
	disabled?: () => boolean;
}

/**
 * 具名插槽渲染组件（k-slot）。
 *
 * 合并两种来源的内容并按 order 降序渲染：
 * - internal：模板里直接写在 k-slot 内的 k-slot-item 子节点；
 * - external：由 ctx.slot() 注册到该插槽名的视图组件。
 * single 模式下只渲染排序最高的一项（用于 activity 页面等独占插槽）。
 */
export const KSlot = defineComponent({
	props: {
		/** 插槽名 */
		name: String,
		/** 透传给外部视图组件的属性 */
		data: Object,
		/** 是否单选模式（只渲染排序最高的一项） */
		single: Boolean,
	},
	setup(props, { slots }) {
		const ctx = useContext();
		return () => {
			// internal：模板内以 k-slot-item 声明的节点，order 取其 props
			const internal = props.single
				? []
				: [...(slots["default"]?.() || [])]
						.filter((node) => node.type === KSlotItem)
						.map((node) => ({ node, order: node.props?.["order"] || 0 }));
			// external：ctx.slot() 注册的视图，disabled 的不渲染
			const external = [
				...(props.name ? ctx.$router.views[props.name] || [] : []),
			]
				.filter((item) => !item.disabled?.())
				.map((item) => ({
					node: h(item.component, { ...props.data }, slots),
					order: item.order,
					layer: 1,
				}));
			const children = [...internal, ...external].sort(
				(a, b) => b.order - a.order,
			);
			if (props.single) {
				// 无外部视图时回退到模板默认内容
				return children[0]?.node || slots["default"]?.();
			}
			return children.map((item) => item.node);
		};
	},
});

/** 插槽条目包装组件（k-slot-item）：仅透传 order 排序权重 */
const KSlotItem = defineComponent({
	props: {
		order: Number,
	},
	setup(_props, { slots }) {
		return () => slots["default"]?.();
	},
});

/** 生成绑定固定插槽名的单选 k-slot 快捷组件 */
function defineSlotComponent(name: string) {
	return defineComponent({
		inheritAttrs: false,
		setup(_, { slots, attrs }) {
			return () => h(KSlot, { name, data: attrs, single: true }, slots);
		},
	});
}

/** 注册插槽相关全局组件（k-slot / k-slot-item / k-layout / k-status） */
export default (app: App) => {
	app.component("k-slot", KSlot);
	app.component("k-slot-item", KSlotItem);
	app.component("k-layout", defineSlotComponent("layout"));
	app.component("k-status", defineSlotComponent("status"));
};
