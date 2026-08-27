<template>
  <span class="k-link" @click.stop="active = name">
    {{ name }}
  </span>
  <span v-if="store.packages[name]?.runtime?.id"> (已加载)</span>
  <span v-else> (点击{{ name in store.packages ? '配置' : '添加' }})</span>
</template>

<script lang="ts" setup>
import { store } from "@koishi-ce/client";
import {} from "@koishi-ce/plugin-config";
import { active } from "../utils";

defineProps<{
	name: string;
}>();
</script>
