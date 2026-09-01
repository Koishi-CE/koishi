<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <k-comment type="danger">
    <p>
      <span>此插件尚未安装，</span>
      <span v-if="fullname" class="k-link" @click="active = fullname">点击快速安装</span>
      <span v-else class="k-link" @click="gotoMarket">点击前往插件市场</span>
      <span>。</span>
    </p>
  </k-comment>
</template>

<script setup lang="ts">
import { store } from "@koishi-ce/client";
import { computed, inject, type WritableComputedRef } from "vue";
import { useRouter } from "vue-router";
import { active } from "../utils";

const router = useRouter();

// 由配置管理面板注入的「当前插件」信息（此处仅需 name 字段）
const current = inject<WritableComputedRef<{ name: string }>>(
	"manager.settings.current",
);

const fullname = computed(() => {
	const name = current.value?.name;
	if (!name) return;
	const candidates = name.startsWith("@")
		? [name.replace(/\//, "/koishi-plugin-")]
		: [`@koishijs/plugin-${name}`, `koishi-plugin-${name}`];
	return candidates.find((name) => name in store.market.data);
});

function gotoMarket() {
	router.push(`/market?keyword=${current.value?.name ?? ""}`);
}
</script>
