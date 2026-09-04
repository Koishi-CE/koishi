<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  单个浮动上下文菜单（页面模板中 <k-menu> 的内置实现）：
  依据触发点的锚点矩形（props.relative）与自身实际尺寸，
  逐轴选择向左 / 向右、向上 / 向下展开，避免菜单溢出视口。
-->
<template>
  <div ref="el" class="k-menu" :style="getStyle()">
    <template v-for="item of ctx.internal.menus[id]">
      <div class="k-menu-separator" v-if="item.id === '@separator'"></div>
      <menu-item v-else v-bind="{ prefix: id, ...item }"></menu-item>
    </template>
  </div>
</template>

<script lang="ts" setup>
import {
	type ActiveMenu,
	useContext,
} from "@koishi-ce/client";
import { ref } from "vue";
import MenuItem from "./menu-item.vue";

const props = defineProps<ActiveMenu>();

const ctx = useContext();

const el = ref<HTMLElement>();

// relative 携带触发点矩形的 left / right / bottom（相对视口），
// 结合菜单自身渲染后的实际宽高计算定位；尚未挂载时先隐藏避免闪烁
const getStyle = () => {
	if (!el.value) return { visibility: "hidden" };
	const { height, width } =
		el.value.getBoundingClientRect();
	const style: Partial<
		Record<"top" | "right" | "bottom" | "left", string>
	> = {};
	if (props.relative.right + width > window.innerWidth) {
		style.right = `${window.innerWidth - props.relative.left}px`;
	} else {
		style.left = `${props.relative.right}px`;
	}
	if (props.relative.bottom + height > window.innerHeight) {
		style.bottom = `0px`;
	} else {
		style.top = `${props.relative.bottom}px`;
	}
	return style;
};
</script>
