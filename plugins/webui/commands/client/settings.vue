<template>
  <k-comment type="success" v-if="list.length">
    <p>此插件提供了下列指令：</p>
    <ul>
      <li v-for="item in list" :key="item.name">
        <router-link :to="'/commands/' + item.name.replace(/\./g, '/')">{{ item.name }}</router-link>
      </li>
    </ul>
  </k-comment>
</template>

<script lang="ts" setup>
import { type Dict, useRpc } from "@koishi-ce/client";
import { computed, inject } from "vue";
import type { CommandData } from "../lib";

const current: any = inject("manager.settings.current");

const data = useRpc<Dict<CommandData>>();

const list = computed(() => {
	return Object.values(data.value)
		.filter((item) => item.paths.includes(current.value.path))
		.sort((a, b) => a.name.localeCompare(b.name));
});
</script>

<style lang="scss" scoped>

</style>
