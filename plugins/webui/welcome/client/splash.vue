<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2024 Il Harper (ilharp). -->
<!-- Modifications Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  欢迎页开屏动画：lottie-web（SVG-only 精简构建）驱动的描线动画。
  本文件与 splash.json 均移植自 koishi-plugin-telemetry（MIT，唯一开发者
  Il Harper，https://github.com/koishijs/koishi-plugin-telemetry）的 oob
  客户端：动画数据取自 splash.json，加载接线取自 home.vue，类名已本地化，
  详见 NOTICE 溯源表。该文件保持 MIT 授权，不随所在目录适用 AGPL。

  动画内描线颜色不在 JSON 里指定（透明），而是经 cl class
  （welcome-splash-ray / welcome-splash-figure）映射到宿主主题变量，
  自动适配明暗主题；样式钩子见下方 style 块。
-->

<template>
  <div ref="container" class="splash"></div>
</template>

<script lang="ts" setup>
import type { AnimationItem } from "lottie-web";
import lottie from "lottie-web/build/player/esm/lottie_svg.min.js";
import { onBeforeUnmount, onMounted, ref } from "vue";
import splashData from "./splash.json";

const container = ref<HTMLElement>();
let animation: AnimationItem | undefined;

onMounted(() => {
	// 减少动态效果偏好下不挂动画，欢迎卡回落为静态形态
	// （高度回落见 welcome.vue 的 :has() 回退规则）
	if (
		matchMedia("(prefers-reduced-motion: reduce)").matches
	)
		return;
	const el = container.value;
	if (!el) return;
	animation = lottie.loadAnimation({
		animationData: splashData,
		container: el,
		renderer: "svg",
		loop: true,
		autoplay: true,
		rendererSettings: {
			preserveAspectRatio: "xMidYMid slice",
		},
	});
});

onBeforeUnmount(() => {
	animation?.destroy();
	animation = undefined;
});
</script>

<style lang="scss">

// 描线主题化：JSON 内描边色为透明呈现属性，CSS 类覆盖之（可改色/改深浅）
.page-home .welcome .splash {
  position: absolute;
  inset: 0;
  pointer-events: none;

  .welcome-splash-ray {
    stroke: var(--bg3);
  }

  .welcome-splash-figure {
    stroke: var(--bg3);
  }
}

</style>
