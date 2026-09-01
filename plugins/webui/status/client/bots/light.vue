<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!-- 状态指示灯：纯展示组件，本身无颜色；
     颜色由父组件按机器人状态附加 class 决定（online / connect / error / offline）。 -->
<template>
  <span class="status-light"></span>
</template>

<style lang="scss" scoped>

$size: 0.625rem;

.status-light {
  border-radius: $size;
  transition: var(--color-transition);
  width: $size;
  height: $size;

  &.online {
    background-color: var(--k-color-success);
  }
  &.connect, &.reconnect {
    background-color: var(--k-color-warning);
  }
  &.error {
    background-color: var(--k-color-danger) !important;
  }
  &.offline {
    background-color: var(--k-color-disabled);
  }
  & + & {
    margin-left: 4px;
  }
}

</style>
