<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  k-content：页面主内容区容器。
  水平居中、限宽 55rem，自带垂直滚动（el-scrollbar），
  左右留白随屏幕宽度自适应收窄。
-->
<template>
  <el-scrollbar>
    <div class="k-content">
      <slot></slot>
    </div>
  </el-scrollbar>
</template>

<style lang="scss">

.k-content {
  --content-padding: 3rem;

  margin: auto;
  max-width: 55rem;
  box-sizing: border-box;
  padding: 3rem var(--content-padding);

  > :first-child {
    margin-top: 0;
  }

  @media screen and (max-width: 768px) {
    --content-padding: 2rem;
  }

  @media screen and (max-width: 480px) {
    --content-padding: 1.5rem;
  }
}

</style>
