<!-- 状态栏右侧的机器人概况：按在线状态聚合一排状态灯，
     同状态机器人过多（超过 mergeThreshold）时合并为"灯 + ×数量"；
     悬停展开每个机器人的预览卡，点击可跳转到对应插件配置页。
     尾部实时显示全部机器人最近一分钟的收发消息总量。 -->
<template>
  <k-status v-if="store.status">
    <template #tooltip>
      <span v-if="!Object.values(store.status.bots).length" class="el-popper__empty"></span>
      <template v-for="(bot, key) in store.status.bots" :key="key">
        <bot-preview
          :data="bot"
          :class="{ 'has-link': bot.paths?.length }"
          @click="router.push('/plugins/' + bot.paths[0].replace(/\./, '/'))"
        ></bot-preview>
      </template>
    </template>
    <template v-for="(count, status) in statusMap" :key="status">
      <template v-if="count > (config.mergeThreshold ?? 10)">
        <status-light :class="status"></status-light>
        <span class="count">×{{ count }}</span>
      </template>
      <template v-else>
        <status-light v-for="(_, key) in Array(count)" :key="key" :class="status"></status-light>
      </template>
    </template>
    <k-icon name="arrow-up"/>
    <span>{{ sent }}/min</span>
    <k-icon name="arrow-down"/>
    <span>{{ received }}/min</span>
  </k-status>
</template>

<script setup lang="ts">
import { type Dict, router, store, useConfig } from "@koishi-ce/client";
import { computed } from "vue";
import StatusLight from "./light.vue";
import BotPreview from "./preview.vue";
import { getStatus } from "./utils";

const config = useConfig();

// 按状态聚合的计数表（如 { online: 3, offline: 1 }），键名字典序排列保证灯的顺序稳定
const statusMap = computed(() => {
	const map: Dict<number> = {};
	for (const bot of Object.values(store.status.bots)) {
		const key = getStatus(bot.status);
		map[key] = (map[key] || 0) + 1;
	}
	return Object.fromEntries(
		Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])),
	);
});

// 全部机器人最近一分钟发送消息总量
const sent = computed(() => {
	return Object.values(store.status.bots).reduce(
		(acc, bot) => acc + bot.messageSent,
		0,
	);
});

// 全部机器人最近一分钟接收消息总量
const received = computed(() => {
	return Object.values(store.status.bots).reduce(
		(acc, bot) => acc + bot.messageReceived,
		0,
	);
});
</script>

<style lang="scss" scoped>

.k-status {
  .k-icon {
    margin-right: 4px;
  }

  * + .k-icon {
    margin-left: 6px;
  }

  .count {
    margin: 0 4px 0 4px;
    letter-spacing: 1px;
  }
}

</style>
