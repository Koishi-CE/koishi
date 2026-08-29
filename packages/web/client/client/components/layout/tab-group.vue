<!--
  k-tab-group：侧栏式选项卡分组。
  遍历 data（键 → 条目对象），filter 可按条目过滤显示；
  每个条目渲染为一个 k-tab-item，选中键经 v-model 双向绑定，
  条目数据通过作用域插槽传给内容。
-->
<template>
  <template v-for="(item, key) in data" :key="key">
    <k-tab-item v-model="model" :label="key"
      v-if="filter ? filter(item) : true">
      <slot v-bind="item"></slot>
    </k-tab-item>
  </template>
</template>

<script lang="ts" setup>
import { computed } from "vue";

const props = defineProps<{
	data: object;
	modelValue?: string;
	filter?: (item: unknown) => boolean;
}>();

const emits = defineEmits(["update:modelValue"]);

const model = computed({
	get: () => props.modelValue,
	set: (val) => emits("update:modelValue", val),
});
</script>

<style lang="scss">

.k-tab-group-title {
  line-height: 2.25rem;
  padding: 0 2rem !important;
  font-weight: bold;
}

.k-tab-group-title:not(.k-select-item) {
  margin-top: 0.5rem;
}

</style>
