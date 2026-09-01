<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  活动栏单个图标按钮，也是拖拽排序的拖拽源：
  拖起时向 dataTransfer 写入 "activity:<id>" 文本供落点组件识别。
  无 id 的项（如溢出组的 "..." 图标）渲染为不可点击的 span。
-->
<template>
  <component
    :is="data.id ? 'k-activity-link' : 'span'"
    class="activity-button"
    draggable="true"
    :id="data.id"
    :class="{ 'dragging': isDragging }"
    @dragstart="handleDragStart"
    @dragend="handleDragEnd">
    <k-icon class="activity-button-icon" :name="data.icon"></k-icon>
  </component>
</template>

<script lang="ts" setup>
import type { Activity } from "@koishi-ce/client";
import { ref } from "vue";

const props = defineProps<{
	data: Activity;
}>();

const isDragging = ref(false);

function handleDragStart(event: DragEvent) {
	isDragging.value = true;
	// 约定的拖拽协议：以 "activity:" 前缀 + 活动 id 标识被拖动的活动项
	event.dataTransfer.setData("text/plain", `activity:${props.data.id}`);
}

function handleDragEnd(event: DragEvent) {
	isDragging.value = false;
}
</script>

<style lang="scss" scoped>

.activity-button {
  height: calc(var(--activity-width) - 2 * var(--activity-padding));
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
  transition: var(--color-transition);
  color: var(--k-text-light);
  border-radius: var(--activity-padding);
  cursor: pointer;

  .activity-button-icon {
    height: var(--activity-icon-size);
    pointer-events: none;
  }

  &:hover, &.dragging {
    color: var(--k-text-dark);
    background-color: var(--k-hover-bg);
  }

  &.active {
    color: var(--k-text-active);
  }

  .badge {
    position: absolute;
    border-radius: 1rem;
    color: #ffffff;
    background-color: var(--k-color-danger);
    top: 50%;
    right: 1.5rem;
    transform: translateY(-50%);
    line-height: 1;
    padding: 4px 8px;
    font-size: 0.75rem;
    font-weight: bolder;
    transition: var(--color-transition);
  }

  &.is-group {
    &::before {
      content: "";
      position: absolute;
      right: 0;
      bottom: 4px;
      width: 0;
      height: 0;
      border: 4px solid;
      border-color: transparent transparent transparent currentColor;
      transition: var(--color-transition);
    }
  }
}

</style>
