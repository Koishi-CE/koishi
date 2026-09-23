<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  k-tab-item：选项卡条目（配合 k-tab-group 使用）。
  label 为条目标识兼默认文案，点击时 emit update:modelValue；
  与当前选中值相等时高亮。
-->
<template>
  <div class="k-tab-item k-tab-menu-item truncate"
    :title="label"
    :class="{ active: label === modelValue }"
    @click="$emit('update:modelValue', label)">
    <slot>{{ label }}</slot>
  </div>
</template>

<script lang="ts" setup>
defineEmits(["update:modelValue"]);

defineProps<{
	label: string;
	modelValue: string;
}>();
</script>

<style lang="scss">

.k-tab-item {
  line-height: 2.25rem;
  padding: 0 2rem 0 4rem;

  &.active {
    background-color: var(--k-hover-bg);
  }
}

</style>
