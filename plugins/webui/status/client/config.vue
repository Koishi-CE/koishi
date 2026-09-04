<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!-- 插件配置页的机器人区块：挂在 plugin-details 插槽位。
     只展示其配置路径（paths）包含当前插件路径的机器人，
     即"由当前插件加载"的那些机器人，并以预览卡形式列出。 -->
<template>
  <template v-if="bots?.length">
    <h2 class="k-schema-header">
      机器人
    </h2>
    <div class="bots-container flex flex-wrap gap-4">
      <bot-preview v-for="(bot, sid) in bots" :key="sid" :data="bot"/>
    </div>
  </template>
</template>

<script setup lang="ts">
import { store } from "@koishi-ce/client";
import { computed, inject, type Ref } from "vue";
import BotPreview from "./bots/preview.vue";

// 由配置管理面板注入的「当前插件」信息（此处仅需 path 字段）
const current = inject<Ref<{ path: string }>>(
	"manager.settings.current",
);

// 过滤出配置路径里包含当前插件路径的机器人（当前正在查看配置的插件）
const bots = computed(() => {
	return Object.values(store.status?.bots || {}).filter(
		(bot) => {
			return bot.paths?.includes(current.value.path);
		},
	);
});
</script>

<style scoped lang="scss">

.bots-container {
  .bot-view {
    background-color: var(--bg0);
    border-radius: 0.5rem;
  }
}

</style>
