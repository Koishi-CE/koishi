<!-- 首页数值卡网格：用户总数 / 群组总数 / 今日 DAU 三张统计卡，
     各自以页脚形式附带昨日增量或近期均值。数值卡本体通过 provide
     暴露为 analytic-number 组件，status 插件的 QPS 卡也挂入同一插槽复用样式。 -->
<template>
  <div class="card-grid numeric-grid" v-if="store.analytics">
    <k-slot name="analytic-number">
      <k-slot-item>
        <numeric icon="analytic:user" title="用户数量">
          <template #default>{{ store.analytics.userCount }}</template>
          <template #footer-left>昨日新增用户</template>
          <template #footer-right>{{ store.analytics.userIncrement }}</template>
        </numeric>
        <numeric icon="analytic:guild" title="群组数量">
          <template #default>{{ store.analytics.guildCount }}</template>
          <template #footer-left>昨日新增群组</template>
          <template #footer-right>{{ store.analytics.guildIncrement }}</template>
        </numeric>
        <numeric icon="analytic:heart" title="今日 DAU">
          <template #default>{{ store.analytics.dauHistory[0] }}</template>
          <template #footer-left>近期 DAU</template>
          <template #footer-right>{{ +recentDau.toFixed(1) }}</template>
        </numeric>
      </k-slot-item>
    </k-slot>
  </div>
</template>

<script setup lang="ts">
import { store } from "@koishi-ce/client";
import type {} from "@koishi-ce/plugin-analytics/src";
import { computed, provide } from "vue";
import Numeric from "./numeric.vue";

provide("component:analytic-number", Numeric);

// 近期 DAU：剔除今天的占位后取历史天数的平均值（天数不足时按实际天数除）
const recentDau = computed(() => {
	const data = store.analytics.dauHistory.slice(1);
	const historyLength = store.analytics.dauHistory.length - 1;
	if (!historyLength) return 0;
	return data.reduce((a, b) => a + b, 0) / Math.min(data.length, historyLength);
});
</script>

<style lang="scss" scoped>

.numeric-grid {
  grid-template-columns: repeat(4, 1fr);

  @media screen and (max-width: 1280px) {
    grid-template-columns: repeat(2, 1fr);
  }
}

</style>
