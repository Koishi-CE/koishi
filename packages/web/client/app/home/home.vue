<!--
  控制台首页：WebSocket 就绪后渲染 "home" 插槽内容（默认为欢迎卡片），
  未连接时显示连接提示卡片。
-->
<template>
  <k-layout :main="`darker page-home${socket ? '' : ' loading'}`">
    <el-scrollbar v-if="socket">
      <k-slot name="home">
        <k-slot-item :order="1000">
          <welcome></welcome>
        </k-slot-item>
      </k-slot>
    </el-scrollbar>
    <div v-else>
      <k-card class="connect">正在连接到 Koishi 服务器……</k-card>
    </div>
  </k-layout>
</template>

<script lang="ts" setup>
import { global, socket } from "@koishi-ce/client";
import Welcome from "./welcome.vue";
</script>

<style lang="scss">

.page-home {
  &.loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }

  .k-card.welcome {
    margin: var(--card-margin);
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
