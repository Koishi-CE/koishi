<template>
  <!-- 日志页面外壳：把 logs 服务数据交给 logs 组件渲染，并开启来源插件跳转链接 -->
  <k-layout>
    <logs class="layout-logger" :logs="store.logs" show-link></logs>
  </k-layout>
</template>

<script lang="ts" setup>
import { store } from "@koishi-ce/client";
import Logs from "./logs.vue";
</script>
