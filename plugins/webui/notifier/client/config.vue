<template>
  <k-comment v-for="item in notifiers" :type="item.type">
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
import type segment from "@satorijs/element";
import {
	computed,
	type FunctionalComponent,
	h,
	inject,
	resolveComponent,
} from "vue";

// manager 注入的当前插件配置对象(含 path 字段标识插件来源)
const current: any = inject("manager.settings.current");

const data = useRpc<NotifierService.Data>();

// 仅保留归属当前插件、且内容非空的通知
const notifiers = computed(() => {
	return data.value.notifiers.filter((item) => {
		return item.paths?.includes(current.value.path) && item.content;
	});
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
const render: FunctionalComponent<{ children: segment[] }> = (
	{ children },
	ctx,
) => {
	return children.map(({ type, attrs, children }) => {
		if (type === "text") {
			return attrs.content;
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
					onClick: () => send("notifier/button", attrs.onClick),
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
