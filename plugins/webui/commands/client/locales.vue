<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <!-- 本地化页面的指令跳转插槽：正在编辑 commands.* 前缀的词条时显示「前往指令」入口 -->
  <div v-if="active && active.startsWith('commands.')" class="navigation flex flex-wrap gap-x-4 gap-y-2 my-8">
    <router-link
      class="el-button"
      :to="'/commands/' + active.slice(9).replace(/\./, '/')"
    >前往指令</router-link>
  </div>
</template>

<script lang="ts" setup>
import { type ComputedRef, inject } from "vue";

// 本地化页面注入的「当前编辑的词条前缀」（如 "commands.foo"）
const active = inject<ComputedRef<string>>("locale:prefix");
</script>

<style lang="scss" scoped>

</style>
