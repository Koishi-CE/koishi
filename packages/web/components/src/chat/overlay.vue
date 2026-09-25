<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  overlay.vue：全屏图片查看器（经 router 的 global 插槽挂载）。
  打开时把图片从原位"飞入"屏幕中心（appear 阶段从原坐标过渡到居中），
  关闭时回到原坐标；支持放大/缩小/旋转/复原，左右切换页面内相邻图片，
  键盘操作：方向键切换、Esc 关闭、Enter 关闭并滚动定位到原图片。
-->
<template>
  <transition name="overlay">
    <div class="overlay-image-viewer" v-if="shared.overlayImage" @click="setImage(null)">
      <span class="button left" :class="{ disabled: !siblings.prev }" @click.stop="setImage(siblings.prev)">
        <k-icon name="chevron-left"/>
      </span>
      <span class="button right" :class="{ disabled: !siblings.next }" @click.stop="setImage(siblings.next)">
        <k-icon name="chevron-right"/>
      </span>
      <span class="button bottom" @click.stop>
        <el-tooltip placement="top" :content="t('overlay.zoomOut')" :offset="20">
          <k-icon name="search-minus" @click="scale -= 0.2"/>
        </el-tooltip>
        <el-tooltip placement="top" :content="t('overlay.zoomIn')" :offset="20">
          <k-icon name="search-plus" @click="scale += 0.2"/>
        </el-tooltip>
        <el-tooltip placement="top" :content="t('overlay.reset')" :offset="20">
          <k-icon name="expand" @click="scale = 1, rotate = 0"/>
        </el-tooltip>
        <el-tooltip placement="top" :content="t('overlay.rotateLeft')" :offset="20">
          <k-icon name="undo" @click="rotate -= 90"/>
        </el-tooltip>
        <el-tooltip placement="top" :content="t('overlay.rotateRight')" :offset="20">
          <k-icon name="redo" @click="rotate += 90"/>
        </el-tooltip>
      </span>
      <transition appear :duration="1" @before-appear="onBeforeAppear" @after-appear="onAfterAppear">
        <img ref="img" :style="{ transform }" :src="shared.overlayImage.src"/>
      </transition>
    </div>
  </transition>
</template>

<script lang="ts" setup>
import {
	computed,
	onBeforeUnmount,
	onMounted,
	ref,
	watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { shared } from "./utils";

const { t } = useI18n();

// 用户手动调整的缩放与旋转量（复原即回到 1 / 0）
const scale = ref(1);
const rotate = ref(0);
const img = ref<HTMLImageElement | null>(null);

const transform = computed(() => {
	return `scale(${scale.value}) rotate(${rotate.value}deg)`;
});

// 相邻图片：以文档中 .chat-image（chat/image.vue 渲染）的出现顺序为准；
// 查看器未打开时不存在相邻图，prev / next 均为 undefined
const siblings = computed(() => {
	if (!shared.overlayImage) {
		return { prev: undefined, next: undefined };
	}
	const elements = Array.from(
		document.querySelectorAll<HTMLImageElement>(
			".chat-image",
		),
	);
	const index = elements.indexOf(shared.overlayImage);
	return {
		prev: elements[index - 1],
		next: elements[index + 1],
	};
});

// 初始（适配屏幕）缩放比：按视口剩余空间把图片等比缩小，不放大
const defaultScale = computed(() => {
	const image = shared.overlayImage;
	// 查看器未打开时无图可适配，保持原始缩放
	if (!image) return 1;
	const { naturalHeight, naturalWidth } = image;
	const maxHeight = innerHeight - paddingVertical * 2;
	const maxWidth = innerWidth - paddingHorizontal * 2;
	return Math.min(
		1,
		maxHeight / naturalHeight,
		maxWidth / naturalWidth,
	);
});

// 切换/关闭查看器时重置手动缩放与旋转；
// 关闭（el 为空）时把图片移回原位，切换则平滑过渡到新图居中
watch(
	() => shared.overlayImage,
	(el, origin) => {
		scale.value = 1;
		rotate.value = 0;
		if (!el) {
			// 关闭：飞回原图位置（img 尚未挂载时无从摆放，跳过）
			if (img.value) moveToOrigin(img.value, origin);
			return;
		}
		if (img.value) {
			img.value.style.transition = "0.3s transform ease";
			moveToCenter(img.value);
		}
	},
);

// setImage 的载荷语义：null 表示关闭查看器；undefined 表示目标方向
// 无相邻图（按钮禁用态下的防御），不改变当前展示
function setImage(el: HTMLImageElement | null | undefined) {
	if (el === undefined) return;
	shared.overlayImage = el;
}

/** 把大图元素摆到原图片所在的位置与尺寸（关闭时的"飞回"动画终点） */
function moveToOrigin(
	el: HTMLImageElement,
	origin: HTMLImageElement | null = shared.overlayImage,
) {
	// 无原图可归位（从未打开过查看器）时直接跳过
	if (!origin) return;
	const { height, width } = origin;
	const { left, top } = origin.getBoundingClientRect();
	el.style.width = `${width}px`;
	el.style.height = `${height}px`;
	el.style.left = `${left}px`;
	el.style.top = `${top}px`;
	el.style.transition = "0.3s ease";
}

// transition 钩子的入参类型是 Element；本组件内 appear 的目标只有
// <img>，经 instanceof 收窄后转发给定位函数
function onBeforeAppear(el: Element) {
	if (el instanceof HTMLImageElement) moveToOrigin(el);
}

function onAfterAppear(el: Element) {
	if (el instanceof HTMLImageElement) moveToCenter(el);
}

// 视口四周预留的边距（当前为 0，即允许图片占满视口）
const paddingVertical = 0;
const paddingHorizontal = 0;

/** 把图片按适配缩放比居中摆放到视口中央 */
function moveToCenter(el: HTMLImageElement) {
	const image = shared.overlayImage;
	// 查看器未打开时无图可居中，直接跳过
	if (!image) return;
	const { naturalHeight, naturalWidth } = image;
	const scale = defaultScale.value;
	const width = naturalWidth * scale;
	const height = naturalHeight * scale;
	el.style.width = `${width}px`;
	el.style.height = `${height}px`;
	el.style.left = `${(innerWidth - width) / 2}px`;
	el.style.top = `${(innerHeight - height) / 2}px`;
}

onMounted(() => {
	document.addEventListener("keydown", onKeyDown);
});

onBeforeUnmount(() => {
	document.removeEventListener("keydown", onKeyDown);
});

// 全局键盘操作：查看器打开期间接管方向键 / Esc / Enter
function onKeyDown(ev: KeyboardEvent) {
	if (!shared.overlayImage) return;
	ev.preventDefault();
	if (ev.key === "ArrowUp" || ev.key === "ArrowLeft") {
		setImage(siblings.value.prev);
	} else if (
		ev.key === "ArrowDown" ||
		ev.key === "ArrowRight"
	) {
		setImage(siblings.value.next);
	} else if (ev.key === "Escape") {
		setImage(null);
	} else if (ev.key === "Enter") {
		// 关闭并把页面滚动到原图所在位置，便于继续浏览消息
		// （原图已脱离文档流时无可定位，跳过滚动）
		shared.overlayImage.offsetParent?.scrollIntoView({
			behavior: "smooth",
		});
		setImage(null);
	}
}
</script>

<style lang="scss">

@use '../viewer-toolbar.scss' as *;

.overlay-enter-from, .overlay-leave-to {
  opacity: 0;
}

.overlay-enter, .overlay-leave {
  opacity: 1;
}

.overlay-image-viewer {
  position: fixed;
  left: 0;
  bottom: 0;
  top: 0;
  right: 0;
  z-index: 1000;
  transition: 0.4s opacity ease;
  user-select: none;
  background-color: #0006;

  @include viewer-toolbar;

  img {
    position: absolute;
  }
}

</style>
