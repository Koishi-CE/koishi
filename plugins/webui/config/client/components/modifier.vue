<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <div class="modifier">
    <h2 class="k-schema-header">过滤器设置</h2>
    <k-filter v-model="filter"></k-filter>
  </div>
</template>

<script lang="ts" setup>
/**
 * 过滤器设置组件：编辑插件/分组配置中的 $filter 字段
 * （决定插件在哪些会话/频道生效的上下文过滤条件）。
 * 以 v-model 形式与父级配置对象双向绑定。
 */
import { computed } from "vue";

const props = defineProps<{
	modelValue: Record<string, unknown>;
}>();

const emit = defineEmits(["update:modelValue"]);

// 读写都代理到 modelValue.$filter 这一个字段
const filter = computed({
	get: () => props.modelValue?.$filter,
	set: (value) =>
		emit("update:modelValue", {
			...props.modelValue,
			$filter: value,
		}),
});
</script>

<style lang="scss">

.modifier {
  margin-bottom: 2rem;
}

</style>
