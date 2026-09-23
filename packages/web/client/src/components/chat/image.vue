<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  chat-image：聊天消息中的图片。
  普通点击打开内置大图查看器（overlay.vue，经 global 插槽全局挂载）；
  按住 meta 键（macOS 为 Cmd）点击则在新标签页直接打开原图。
-->
<template>
  <img class="chat-image" :src="src" @click="handleClick"/>
</template>

<script lang="ts" setup>
import { shared } from "./utils";

const props = defineProps<{ src: string }>();

function handleClick(ev: MouseEvent) {
	ev.preventDefault();
	// 事件处理器的返回值无人消费：打开新窗口后统一补 undefined 返回
	if (ev.metaKey) {
		window.open(props.src, "_blank");
		return undefined;
	}
	shared.overlayImage = ev.target as HTMLImageElement;
}
</script>
