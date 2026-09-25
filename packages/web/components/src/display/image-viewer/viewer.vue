<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  图片查看器（全局组件 k-image-viewer）：在容器内居中展示单张图片，
  底部悬浮工具条（共享组件 ViewerToolbar）提供缩小 / 放大 / 复原 / 旋转
  操作。切换图片后自动复位缩放与旋转，容器尺寸变化（useResizeObserver）
  或图片换源时重新按 naturalWidth / naturalHeight 等比缩放并居中。
-->
<template>
  <div class="image-viewer" ref="container">
    <slot></slot>
    <ViewerToolbar :ctrl="ctrl"/>
    <img v-if="src" :key="src" ref="img" :style="{ transform }" :src="src"/>
  </div>
</template>

<script lang="ts" setup>
import { useResizeObserver } from "@vueuse/core";
import { ref, watch } from "vue";
import ViewerToolbar from "./toolbar.vue";
import { useImageTransform } from "./use-transform";

const props = defineProps<{
	src?: string;
}>();

// 缩放 / 旋转的变换控制器（与全屏查看器共用同一套实现）；
// 切换图片源时复位（不关心新旧值，仅监听变化）。
// transform 解构到顶层：嵌在 ctrl 对象里的 computed 不受模板
// 顶层 ref 解包眷顾，直接绑 :style 会把 ref 本体传下去
const ctrl = useImageTransform(() => props.src);
const { transform } = ctrl;

const img = ref<HTMLImageElement | null>(null);
const container = ref<HTMLDivElement | null>(null);

// 图片元素挂载 / 更新后重新定位居中
watch(img, moveToCenter);

// 容器尺寸变化（如窗口缩放）时重新居中
useResizeObserver(container, () => {
	moveToCenter(img.value);
});

/**
 * 按图片固有宽高与容器大小计算等比缩放，并以绝对定位居中：
 * 直接写 style 的 width / height / left / top（不使用 transform，
 * 避免与用户缩放 / 旋转的 transform 相互干扰）。
 */
function moveToCenter(el: HTMLImageElement | null) {
	if (!el || !container.value) return;
	const { naturalHeight, naturalWidth } = el;
	const maxHeight = container.value.clientHeight;
	const maxWidth = container.value.clientWidth;
	const scale = Math.min(
		1,
		maxHeight / naturalHeight,
		maxWidth / naturalWidth,
	);
	const width = naturalWidth * scale;
	const height = naturalHeight * scale;
	el.style.width = `${width}px`;
	el.style.height = `${height}px`;
	el.style.left = `${(maxWidth - width) / 2}px`;
	el.style.top = `${(maxHeight - height) / 2}px`;
}
</script>

<style lang="scss">

@use './toolbar.scss' as *;

.image-viewer {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;

  @include viewer-toolbar;

  img {
    position: absolute;
    transition: 0.3s ease;
  }
}

</style>
