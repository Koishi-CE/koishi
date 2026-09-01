<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <k-status v-if="route.path.startsWith('/files')">
    {{ language.aliases[0] ?? language.id }}
  </k-status>
</template>

<script lang="ts" setup>
// 状态栏指示：在 /files 路由下显示当前编辑文件的语言名
import { useRoute } from "vue-router";
import { language } from "./editor";

const route = useRoute();
</script>
