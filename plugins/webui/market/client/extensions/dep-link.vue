<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <span class="k-link" @click.stop="active = target">{{ name }}</span>
  <span v-if="provider?.runtime?.id"> (已加载)</span>
  <span v-else> (点击{{ provider ? '配置' : '添加' }})</span>
</template>

<script lang="ts" setup>
import { store } from "@koishi-ce/client";
import {} from "@koishi-ce/plugin-config";
import { computed } from "vue";
import { active } from "../utils";

const props = defineProps<{
	name: string;
}>();

// 与 config 插件的 resolveProvider 同规则（config/client/components/utils.ts）：
// 上游名在本生态里由 shim / npm alias 占名，字面名查不到 store.packages 时
// 回退查对应的 @koishi-ce/plugin-* 再分发名（故此处内联同一段逻辑，而不从
// config 的 client 入口取值——那会把整份 config 前端打进 market 的产物）
const provider = computed(() => {
	const direct = store.packages?.[props.name];
	if (direct) return direct;
	if (!props.name.startsWith("@koishijs/plugin-")) return;
	return store.packages?.[
		`@koishi-ce/plugin-${props.name.slice("@koishijs/plugin-".length)}`
	];
});

// 点击目标跟随解析结果：安装 / 配置流程均按真实包名工作
const target = computed(
	() => provider.value?.name || props.name,
);
</script>
