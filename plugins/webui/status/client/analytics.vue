<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!-- 当前 QPS 数值卡：挂到 analytic-number 插槽位，供 analytics 插件的数值网格复用。
     主值取全部机器人最近 60 秒接收消息的均值；页脚对比值取 analytics 服务
     最近 7 天按日统计的接收消息折算成的每秒均值。 -->
<template>
  <analytic-number icon="analytic:pulse" title="当前 QPS">
    <template #default>{{ +current.toFixed(2) }}</template>
    <template #footer-left>近期 QPS</template>
    <template #footer-right>{{ +recent.toFixed(2) }}</template>
  </analytic-number>
</template>

<script setup lang="ts">
import { store } from "@koishi-ce/client";
import type {} from "@koishi-ce/plugin-analytics/src";
import { computed, inject } from "vue";

const AnalyticNumber = inject("component:analytic-number");

// 当前 QPS：全部机器人最近一分钟接收消息总数 / 60 秒
const current = computed(() => {
	return (
		Object.values(store.status.bots).reduce(
			(acc, bot) => acc + bot.messageReceived,
			0,
		) / 60
	);
});

// 近期 QPS：最近 7 天接收消息总量除以 7 天的总秒数，得到日均每秒均值
const recent = computed(() => {
	return (
		Object.values(store.analytics.messageByDate)
			.slice(-7)
			.reduce((acc, value) => acc + value.receive, 0) /
		7 /
		24 /
		60 /
		60
	);
});
</script>
