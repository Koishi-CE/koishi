<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <!-- 权限名称显示：指令 / 用户组前缀特殊处理，其余优先取本地化词条，缺省回退原始 id -->
  <template v-if="id.startsWith('command:')">
    指令：{{ id.slice(8) }}
  </template>
  <template v-else-if="id.startsWith('group:')">
    用户组：{{ store.locales?.[`permission.${id}`] || data.group[id.slice(6)].name || '未命名' }}
  </template>
  <template v-else>
    {{ store.locales?.[`permission.${id}`] || id }}
  </template>
</template>

<script setup lang="ts">
// 权限管理页使用的「权限名称」展示组件（见模板注释）
import { store, useRpc } from "@koishi-ce/client";
import type Admin from "@koishi-ce/plugin-admin/src";

// id 必传：调用方（权限表行 / 权限下拉选项）均传入非空字符串，
// 改用类型声明使模板内 id 不再是 string | undefined
defineProps<{
	id: string;
}>();

const data = useRpc<Admin.Data>();
</script>
