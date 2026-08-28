<!--
  通用状态项容器（页面模板中 <k-status> 的内置实现）：
  内容区 + 悬停时的 tooltip（内容经 el-scrollbar 限高滚动）。
  inheritAttrs 关闭，让外部透传的属性落到内层 div 而非根组件。
-->
<template>
  <el-tooltip placement="top" effect="light" popper-class="k-status-tooltip">
    <template #content>
      <el-scrollbar max-height="calc(100vh - 4rem)">
        <slot name="tooltip">
          <span class="el-popper__empty"></span>
        </slot>
      </el-scrollbar>
    </template>
    <div class="k-status" v-bind="$attrs">
      <slot></slot>
    </div>
  </el-tooltip>
</template>

<script lang="ts" setup>
defineOptions({
	inheritAttrs: false,
});
</script>

<style lang="scss" scoped>

.k-status {
  cursor: default;
  padding: 0 0.5rem;
  display: inline-flex;
  align-items: center;
  transition: var(--color-transition);
  user-select: none;
  cursor: pointer;

  &:hover {
    background-color: var(--k-hover-bg);
  }
}

</style>

<style lang="scss">

.el-popper.k-status-tooltip {
  padding: 0 0;
  border-radius: 8px;

  .el-popper__empty + .el-popper__arrow {
    display: none;
  }
}

</style>
