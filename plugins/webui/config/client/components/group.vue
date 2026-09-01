<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <k-modifier v-model="config"></k-modifier>
</template>

<script lang="ts" setup>
/**
 * 分组设置面板：分组节点（group:xxx）的配置编辑区。
 * 分组本身只有过滤器设置（$filter），复用 modifier 组件。
 */
import { computed } from "vue";
import KModifier from "./modifier.vue";
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

<style lang="scss" scoped>

h2 {
  font-size: 1.25rem;
}

</style>
