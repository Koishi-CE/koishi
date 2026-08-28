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

defineProps({
	id: String,
});

const data = useRpc<Admin.Data>();
</script>
