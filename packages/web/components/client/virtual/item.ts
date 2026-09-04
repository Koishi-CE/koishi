// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 虚拟列表的条目包装组件（VirtualItem）：给插槽内容的根元素挂上
 * 自定义指令以捕获 DOM 引用，再用 ResizeObserver 监听其尺寸变化，
 * 把「高度 + marginTop」上报给父级（list.vue 转交 Virtual.saveSize）。
 * 另导出工具 useRefDirective（模板 ref 转指令的通用写法）与
 * findFirstLegitChild（跳过注释/文本节点取第一个真实子节点）。
 */
import {
	Comment,
	type Directive,
	defineComponent,
	Fragment,
	h,
	type Ref,
	ref,
	Text,
	type VNode,
	watch,
	withDirectives,
} from "vue";

/**
 * 把模板 ref 包装成指令：在挂载 / 更新时把元素写入 ref，
 * 卸载时清空。用于给并非本组件直接渲染的插槽根元素建立引用。
 */
export const useRefDirective = (
	ref: Ref,
): Directive<Element> => ({
	mounted(el) {
		ref.value = el;
	},
	updated(el) {
		ref.value = el;
	},
	beforeUnmount() {
		ref.value = null;
	},
});

/**
 * 在 vnode 数组中找到第一个「真实」子节点：跳过注释节点，文本节点
 * 包一层 span，Fragment 递归下钻；找不到返回 null。
 */
function findFirstLegitChild(
	node: VNode[] | undefined,
): VNode | null | undefined {
	if (!node) return null;
	for (const child of node) {
		if (typeof child === "object") {
			switch (child.type) {
				case Comment:
					continue;
				case Text:
					break;
				case Fragment:
					return findFirstLegitChild(
						child.children as VNode[],
					);
				default:
					if (typeof child.type === "string") return child;
					return child;
			}
		}
		return h("span", child);
	}
	// 数组耗尽仍未命中真实子节点（noImplicitReturns）
	return undefined;
}

const VirtualItem = defineComponent({
	props: {
		class: {},
	},

	emits: ["resize"],

	setup(_props, { attrs, slots, emit }) {
		let resizeObserver: ResizeObserver;
		const root = ref<HTMLElement>();

		// 根元素出现 / 更换时重建监听（旧 observer 先断开）
		watch(root, (value) => {
			resizeObserver?.disconnect();
			if (!value) return;

			resizeObserver = new ResizeObserver(
				dispatchSizeChange,
			);
			resizeObserver.observe(value);
		});

		// 上报尺寸：offsetHeight 不含外边距，需补上 marginTop（外间距折叠场景）
		function dispatchSizeChange() {
			if (!root.value) return;
			const marginTop = +getComputedStyle(
				root.value,
			).marginTop.slice(0, -2);
			emit("resize", root.value.offsetHeight + marginTop);
		}

		const directive = useRefDirective(root);

		return () => {
			const head = findFirstLegitChild(
				slots["default"]?.(attrs),
			);
			// 插槽无真实子节点时不渲染（防御；正常使用必有内容）
			return head
				? withDirectives(head, [[directive]])
				: null;
		};
	},
});

export default VirtualItem;
