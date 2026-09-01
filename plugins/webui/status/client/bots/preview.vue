<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!-- 单个机器人的预览卡：头像（经代理加载）+ 右下角状态灯（悬停显示状态文案）、
     昵称、平台与最近一分钟的收发消息速率。用于状态栏悬停层与插件配置页。 -->
<template>
  <section class="bot-view">
    <div class="avatar" :style="{ backgroundImage: `url(${withProxy(data.user.avatar)})` }" @click="$emit('avatar-click')">
      <el-tooltip :content="statusNames[data.status]" placement="right">
        <status-light :class="getStatus(data.status)"></status-light>
      </el-tooltip>
    </div>
    <div class="info">
      <div class="truncate" :title="data.user.name"><k-icon name="robot"/>{{ data.user.name }}</div>
      <div class="truncate" :title="data.platform"><k-icon name="platform"/>{{ data.platform }}</div>
      <div class="truncate cur-frequency">
        <span style="margin-right: 8px">
          <k-icon name="arrow-up"/>
          <span>{{ data.messageSent }}/min</span>
        </span>
        <span>
          <k-icon name="arrow-down"/>
          <span>{{ data.messageReceived }}/min</span>
        </span>
      </div>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { Universal, withProxy } from "@koishi-ce/client";
import type { ProfileProvider } from "@koishi-ce/plugin-status";
import StatusLight from "./light.vue";
import { getStatus } from "./utils";

// 状态枚举值到悬停提示文案的映射
const statusNames: Record<Universal.Status, string> = {
	[Universal.Status.ONLINE]: "运行中",
	[Universal.Status.OFFLINE]: "离线",
	[Universal.Status.CONNECT]: "正在连接",
	[Universal.Status.RECONNECT]: "正在重连",
	[Universal.Status.DISCONNECT]: "正在断开",
};

defineProps<{
	data: ProfileProvider.BotData;
}>();
</script>

<style scoped lang="scss">

.bot-view {
  width: 15rem;
  padding: 0.75rem 1rem;
  font-size: 14px;
  display: flex;
  transition: 0.3s ease;

  & + & {
    border-top: 1px solid var(--k-color-divider);
  }

  &.active {
    > div.avatar {
      border-color: var(--active);
    }
  }

  > div.avatar {
    position: relative;
    width: 4rem;
    height: 4rem;
    box-sizing: content-box;
    border: 1px solid var(--k-color-divider);
    transition: border 0.3s ease;
    border-radius: 100%;
    background-size: 100%;
    background-repeat: no-repeat;
    transition: 0.1s ease;
    flex-shrink: 0;

    $borderWidth: 1px;

    .status-light {
      position: absolute;
      bottom: -$borderWidth;
      right: -$borderWidth;
      width: 0.875rem;
      height: 0.875rem;
      border: $borderWidth solid var(--k-color-divider);
    }
  }

  > div.info {
    flex-grow: 1;
    margin-left: 1.25rem;
    display: flex;
    flex-direction: column;
    justify-content: space-around;
    overflow: hidden;

    .k-icon {
      width: 20px;
      margin-right: 6px;
      text-align: center;
      vertical-align: -2px;
    }
  }

  &.has-link {
    cursor: pointer;
    &:hover {
      background-color: var(--bg1);
    }
  }
}

</style>
