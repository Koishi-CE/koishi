<!--
  dynamic.vue：动态 schema 表单控件（any + dynamic 角色）。
  适用于"具体结构由服务端决定"的配置项：本地 schema 只带 meta.extra.name，
  实际 schema 由服务端经 schema 数据服务下发（store.schema），
  在此"水合"为完整 Schema 后转交 k-schema 渲染；
  未取到时回退到 schema-base 按本地（不完整）schema 渲染。
-->
<template>
  <k-schema
    v-if="inner"
    :modelValue="modelValue"
    @update:modelValue="$emit('update:modelValue', $event)"
    :schema="{ ...inner, meta: { ...schema.meta, ...inner.meta } }"
    :initial="initial"
    :disabled="disabled"
    :prefix="prefix"
  >
    <template #title><slot name="title"></slot></template>
    <template #prefix><slot name="prefix"></slot></template>
    <template #suffix><slot name="suffix"></slot></template>
  </k-schema>

  <schema-base
    v-else
    :modelValue="modelValue"
    @update:modelValue="$emit('update:modelValue', $event)"
    :schema="schema"
    :initial="initial"
    :disabled="disabled"
    :prefix="prefix"
  >
    <template #title><slot name="title"></slot></template>
    <template #desc><slot name="desc"></slot></template>
    <template #menu><slot name="menu"></slot></template>
  </schema-base>
</template>

<script setup lang="ts">
import { Schema, SchemaBase } from "@koishi-ce/components";
import { computed, type PropType } from "vue";
import { store } from "../data";

const props = defineProps({
	schema: {} as PropType<Schema>,
	modelValue: {} as PropType<unknown>,
	disabled: {} as PropType<boolean>,
	prefix: {} as PropType<string>,
	initial: {} as PropType<unknown>,
	extra: {} as PropType<unknown>,
});

defineEmits(["update:modelValue"]);

// 按本地 schema 标注的名称，从服务端下发的 schema 仓库中取出完整定义；
// 元信息做一层合并，保留本地的 meta 覆盖权
const inner = computed(() => {
	const hydrated = store.schema?.[props.schema?.meta.extra?.name];
	return hydrated && new Schema(hydrated);
});
</script>

