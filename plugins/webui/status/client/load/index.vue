<!-- 状态栏右侧的负载概况：常驻显示整机 CPU / 内存占用百分比（各取 LoadRate 的第二项），
     悬停展开双条形图，进一步区分"本进程"与"整机"的占用分布。 -->
<template>
  <k-status v-if="store.status">
    <template #tooltip>
      <div class="load">
        <load-bar title="CPU" :rate="store.status.cpu"/>
        <load-bar title="内存" :rate="store.status.memory"/>
      </div>
    </template>
    CPU: {{ percentage(store.status.cpu[1], 0) }}
    内存: {{ percentage(store.status.memory[1], 0) }}
  </k-status>
</template>

<script setup lang="ts">
import { store } from "@koishi-ce/client";
import LoadBar from "./load-bar.vue";
import { percentage } from "./utils";
</script>

<style lang="scss" scoped>

.load {
  padding: 0.25rem 1rem;
}

</style>
