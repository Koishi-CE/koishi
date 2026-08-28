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
/*
 * 插件详情页的指令列表插槽：列出当前插件提供的全部指令，
 * 每项链接到指令管理页的对应配置面板。
 */
import { type Dict, useRpc } from "@koishi-ce/client";
import { computed, inject } from "vue";
import type { CommandData } from "../lib";

// 由配置管理面板注入的「当前插件」信息
const current: any = inject("manager.settings.current");

const data = useRpc<Dict<CommandData>>();

// paths 记录了指令的来源插件链，第一项匹配当前插件路径即视为其提供
const list = computed(() => {
	return Object.values(data.value)
		.filter((item) => item.paths.includes(current.value.path))
		.sort((a, b) => a.name.localeCompare(b.name));
});
</script>

<style lang="scss" scoped>

</style>
