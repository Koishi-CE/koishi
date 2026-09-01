<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <k-form :schema="store.packages[''].runtime.schema" :initial="current.config" v-model="config"></k-form>
</template>

<script lang="ts" setup>
/**
 * 全局设置面板：根节点（全局设置）的配置编辑区。
 * 直接使用 store.packages[""] 中以 Context.Config 为 schema 的
 * 运行时信息渲染 k-form。
 */
import { store } from "@koishi-ce/client";
import { computed } from "vue";
import type { Tree } from "./utils";

const props = defineProps<{
	current: Tree;
	modelValue: Record<string, unknown>;
}>();

const emit = defineEmits(["update:modelValue"]);

const config = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
});
</script>
