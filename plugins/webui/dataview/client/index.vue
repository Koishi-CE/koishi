<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <k-layout class="page-database">
    <template #header>
      数据库
      <span v-if="store.database?.size">({{ formatSize(store.database.size) }})</span>
    </template>

    <template #menu>
      <span class="menu-item" @click="color = !color">
        <k-icon class="menu-icon" :name="colorIcon"></k-icon>
      </span>
      <span class="menu-item" @click="filter = !filter">
        <k-icon class="menu-icon" :name="filterIcon"></k-icon>
      </span>
      <span class="menu-item" @click="table?.updateData()?.then(() => (config.dataview?.autoStats ?? true) && table?.sendQuery('stats'))">
        <k-icon class="menu-icon" name="refresh"></k-icon>
      </span>
    </template>

    <template #left>
      <el-scrollbar>
        <k-tab-group :data="store.database.tables" v-model="current"></k-tab-group>
      </el-scrollbar>
    </template>

    <keep-alive>
      <k-empty v-if="!current">
        <div>在左侧选择要访问的数据表</div>
      </k-empty>
      <table-view v-else :key="current" :name="current" :filter="filter" :color="color" ref="table"></table-view>
    </keep-alive>
  </k-layout>
</template>

<script lang="ts" setup>
/*
 * 数据库页面外壳：左侧列出全部数据表（k-tab-group），右侧为选中表
 * 的数据表格（data-table.vue）。顶栏三个开关：类型染色、按新行内容
 * 过滤、手动刷新（可联动统计信息同步）。
 */

import { router, store, useConfig } from "@koishi-ce/client";
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import TableView from "./components/data-table.vue";
import { formatSize } from "./utils.ts";

function join(source: string | string[]) {
	return Array.isArray(source) ? source.join("/") : source || "";
}

/** 表格组件暴露的方法（见 data-table.vue 的 defineExpose） */
interface TableExpose {
	sendQuery: (name: "stats") => Promise<unknown>;
	updateData: () => Promise<void>;
}

const table = ref<TableExpose | null>(null);

const route = useRoute();
const config = useConfig();

const filter = ref(false);
const filterIcon = computed(() => (filter.value ? "filter-off" : "filter-on"));

const color = ref(config.value.dataview?.color ?? false);
const colorIcon = computed(() => (color.value ? "rgb-off" : "rgb-on"));

const current = computed<string>({
	get() {
		const name = join(route.params.name ?? "");
		return store.database?.tables[name] ? name : "";
	},
	set(name) {
		if (!store.database?.tables[name]) name = "";
		router.replace(`/database/${name}`);
	},
});

// 表格组件挂载后拉取一次统计信息，随后停止本一次性 watch
const stopWatch = watch(table, (v) => {
	if (!v) return;
	void v.sendQuery("stats");
	stopWatch();
});
</script>

<style lang="scss">

.page-database aside .el-scrollbar__view {
  padding: 1rem 0;
  line-height: 2.25rem;
}

</style>
