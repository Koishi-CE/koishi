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
	if (ev.metaKey) return window.open(props.src, "_blank");
	shared.overlayImage = ev.target as HTMLImageElement;
}
</script>
