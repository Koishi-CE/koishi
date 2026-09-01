<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  k-button：通用按钮组件。
  通过 type（primary / warning / success / error）着色，支持 solid（实心）、
  frameless（无边框）、round（圆形）与 disabled（禁用）等形态；
  禁用时不触发 click 事件、不显示 title 提示。
-->
<template>
  <button
    @click.prevent="onClick"
    :title="disabled ? '' : title"
    :class="['k-button', type, { disabled, solid, round, frameless }]">
    <slot/>
  </button>
</template>

<script lang="ts" setup>
const props = defineProps({
	type: {
		type: String,
		default: "primary",
	},
	solid: Boolean,
	frameless: Boolean,
	title: String,
	round: Boolean,
	disabled: Boolean,
});

const emit = defineEmits(["click"]);

function onClick(event: MouseEvent) {
	// 禁用态吞掉点击，不向外发 click 事件
	if (props.disabled) return;
	emit("click", event);
}
</script>

<style lang="scss">

@mixin apply-color($name) {
  &.#{$name} {
    background-color: var(--#{$name}) !important;
    &:hover {
      background-color: var(--#{$name}-tint) !important;
    }
    &:active {
      background-color: var(--#{$name}-shade) !important;
    }
  }
}

.k-button {
  font-size: 14px;
  font-weight: bolder;
  line-height: 20px;
  appearance: none;
  user-select: none;
  border: none;
  border-radius: 0.4em;
  cursor: pointer;
  padding: 0.4em 1em;
  transition: var(--color-transition);
  display: inline-block;

  // 默认形态：透明背景 + 描边
  color: var(--el-button-text-color);
  border: 1px solid var(--k-color-border);
  background-color: transparent;

  &.round {
    border-radius: 50%;
  }
  &:focus {
    outline: 0;
  }
  &.disabled {
    cursor: default;
  }

  &.disabled {
    color: var(--k-color-disabled);
    border-color: var(--k-color-border);
  }
  &:hover:not(.disabled) {
    color: var(--k-text-dark);
    border: 1px solid var(--k-color-border);
  }

  &.solid {
    color: #ffffff !important;
    border-color: transparent !important;
    &.disabled {
      background-color: var(--k-color-disabled) !important;
    }
    &:not(.disabled) {
      @include apply-color(primary);
      @include apply-color(warning);
      @include apply-color(success);
      @include apply-color(error);
    }
  }

  // 无边框形态：常用于行内文字按钮
  &.frameless {
    padding: 0;
    border-color: transparent;
    background-color: transparent;
    &:hover {
      border-color: transparent;
      background-color: transparent;
    }
    &.primary {
      color: var(--el-color-primary);
    }
    &.error {
      color: var(--el-color-error);
    }
    &.success {
      color: var(--el-color-success);
    }
    &.disabled {
      color: var(--k-color-disabled);
    }
  }
}

</style>
