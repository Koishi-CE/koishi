<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <div class="modifier">
    <h2 class="k-schema-header">{{ t('config.modifier.title') }}</h2>
    <k-filter v-model="filter"></k-filter>
  </div>
</template>

<script lang="ts" setup>
/**
 * 过滤器设置组件：编辑插件/分组配置中的 $filter 字段
 * （决定插件在哪些会话/频道生效的上下文过滤条件）。
 * 以 v-model 形式与父级配置对象双向绑定。
 */

import type { FilterExpr } from "@koishi-ce/components";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{
	modelValue: Record<string, unknown>;
}>();

const emit = defineEmits(["update:modelValue"]);

// 读写都代理到 modelValue.$filter 这一个字段；$filter 字段在宿主配置里是
// unknown 形态（Record<string, unknown>），读侧按 k-filter 的模型契约收窄
const filter = computed<FilterExpr | null>({
	get: () =>
		(props.modelValue?.["$filter"] as
			| FilterExpr
			| null
			| undefined) ?? null,
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
