<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  控制台首页：WebSocket 就绪后渲染 "home" 插槽内容（默认为空——欢迎卡
  由 @koishi-ce/plugin-welcome 提供，统计面板由 plugin-analytics 提供），
  未连接时显示连接提示卡片。
-->
<template>
  <k-layout :main="`darker page-home${socket ? '' : ' loading'}`">
    <el-scrollbar v-if="socket">
      <k-slot name="home"></k-slot>
    </el-scrollbar>
    <div v-else>
      <k-card class="connect">{{ t('home.connecting') }}</k-card>
    </div>
  </k-layout>
</template>

<script lang="ts" setup>
import { global, socket } from "@koishi-ce/client";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
</script>

<style lang="scss">

.page-home {
  &.loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }

  .k-card.connect {
    width: 400px;
    max-width: 400px;
    text-align: center;
    line-height: 2;

    p {
      margin: 0;
    }
  }
}

</style>
