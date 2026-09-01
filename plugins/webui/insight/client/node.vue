<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <g class="node">
    <circle
      :r="isActive ? 12 : 9"
      :cx="node.x"
      :cy="node.y"
    />
    <circle v-if="node.isGroup || node.isRoot"
      :r="isActive ? 8 : 5"
      :cx="node.x"
      :cy="node.y"
    />
    <g class="service" v-if="node.services">
      <line
        :x1="node.x - (isActive ? 5 : 4)"
        :y1="node.y"
        :x2="node.x + (isActive ? 5 : 4)"
        :y2="node.y"
      />
      <line
        :x1="node.x"
        :y1="node.y - (isActive ? 5 : 4)"
        :x2="node.x"
        :y2="node.y + (isActive ? 5 : 4)"
      />
    </g>
  </g>
</template>

<script lang="ts" setup>
// 依赖图的单个节点：外圆为节点主体；分组（Group）/根节点额外叠加内圆；
// 提供服务的节点叠加十字星形标记。isActive（悬停/拖拽焦点）放大图形。
import type { Node } from "./utils";

defineProps<{
	node: Node;
	isActive: boolean;
}>();
</script>

<style lang="scss" scoped>


g.node {
  circle {
    stroke: var(--k-page-bg);
    stroke-opacity: 1;
    stroke-width: 2;
    cursor: pointer;
    fill: var(--k-text-normal);
    transition: r 0.3s ease, opacity 0.3s ease, fill 0.3s ease, stroke 0.3s ease, box-shadow 0.3s ease;
  }

  &:hover {
    circle {
      fill: var(--k-fill-normal);
    }
  }

  .has-highlight &:not(.highlight) circle {
    opacity: 0.3;
  }

  .service line {
    stroke: var(--k-page-bg);
    stroke-opacity: 1;
    stroke-width: 2;
    transition: all 0.3s ease;
    stroke-linecap: round;
  }
}

</style>
