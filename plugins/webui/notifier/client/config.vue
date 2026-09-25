<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <k-comment v-for="(item, index) in notifiers" :key="index" :type="item.type">
    <render :children="segment.parse(item.content)"></render>
  </k-comment>
</template>

<script setup lang="ts">
/**
 * 插件详情页的常驻通知插槽。
 *
 * 从 RPC 数据中筛出归属于当前插件（paths 匹配）且内容非空的通知，
 * 逐条渲染为 k-comment；内容元素由下方 render 函数式组件将
 * segment 元素树映射为 Vue vnode（含 button / progress / spoiler 等特判）。
 */
import { send, useRpc } from "@koishi-ce/client";
import type NotifierService from "@koishi-ce/plugin-notifier/src";
// 模板中调用 segment.parse 需要值导入（type-only 导入不进入模板运行时上下文）
import segment from "@satorijs/element";
import {
	computed,
	type FunctionalComponent,
	h,
	inject,
	type Ref,
	resolveComponent,
} from "vue";

// 由配置管理面板注入的「当前插件」信息（此处仅需 path 字段）
const current = inject<Ref<{ path: string }>>(
	"manager.settings.current",
);

/** notifier RPC 单条数据的本地形状镜像：useRpc 的类型参数所引
 * @koishi-ce/plugin-notifier/src 在浏览器端工程解析不到（tsconfig paths
 * 配置债），filter 回调按 node 侧 Notifier.Data 的形状本地注解。 */
interface NotifierItem {
	type: "primary" | "success" | "warning" | "danger";
	content: string;
	paths?: string[];
}

const data = useRpc<NotifierService.Data>();

// 仅保留归属当前插件、且内容非空的通知
const notifiers = computed(() => {
	// 注入缺失（未在配置面板上下文中渲染）时无从判定归属，保守返回空列表
	const path = current?.value.path;
	if (!path) return [];
	return data.value.notifiers.filter(
		(item: NotifierItem) => {
			return item.paths?.includes(path) && item.content;
		},
	);
});

// 可直接透传为原生 vnode 的元素标签白名单
const forward = [
	"div",
	"ul",
	"ol",
	"li",
	"br",
	"span",
	"p",
	"img",
	"audio",
	"video",
	"b",
	"strong",
	"i",
	"em",
	"u",
	"ins",
	"s",
	"del",
	"code",
];

/**
 * 递归渲染 segment 元素树：
 * - 文本节点原样返回；
 * - 白名单标签直接转为对应 HTML 元素；
 * - spl 渲染为剧透样式 span；button 渲染为 el-button（点击经
 *   notifier/button 事件回调 node 侧登记的 onClick）；
 * - progress 渲染为 el-progress；template 仅展开子元素。
 */
const render: FunctionalComponent<{
	children: segment[];
}> = ({ children }, ctx) => {
	return children.map(({ type, attrs, children }) => {
		if (type === "text") {
			// attrs 为索引签名类型，方括号取值以满足 noPropertyAccessFromIndexSignature
			return attrs["content"];
		} else if (forward.includes(type)) {
			return h(type, attrs, {
				default: () => render({ children }, ctx),
			});
		} else if (type === "spl") {
			return h(
				"span",
				{ class: "spoiler", ...attrs },
				{
					default: () => render({ children }, ctx),
				},
			);
		} else if (type === "button") {
			return h(
				resolveComponent("el-button"),
				{
					...attrs,
					onClick: () =>
						send("notifier/button", attrs["onClick"]),
				},
				{
					default: () => render({ children }, ctx),
				},
			);
		} else if (type === "progress") {
			return h(resolveComponent("el-progress"), attrs, {
				default: () => render({ children }, ctx),
			});
		} else if (type === "template") {
			return render({ children }, ctx);
		}
	});
};
</script>

<style scoped lang="scss">

</style>
