<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <k-slot name="plugin-select-base">
    <template #title="{ packages }">
      <span class="title">{{ t(`market.category.${active}`) }} ({{ packages.length }})</span>
    </template>
    <template #tabs>
      <div class="tabs">
        <el-scrollbar>
          <span class="tab-item" v-for="key in extended" :key="key" @click.stop="active = key" :class="{ active: active === key }">
            <market-icon :name="'solid:' + key"></market-icon>
            <span class="title">{{ t(`market.category.${key}`) }}</span>
          </span>
        </el-scrollbar>
      </div>
    </template>
  </k-slot>
</template>

<script setup lang="ts">
import { store } from "@koishi-ce/client";
import type { PackageProvider } from "@koishi-ce/plugin-config";
import { provide, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
	categories,
	MarketIcon,
	resolveCategory,
} from "../vendor";

const extended = ["all", "other", ...categories];

const { t } = useI18n();

const active = ref("all");

provide(
	"plugin-select-filter",
	({ name, manifest }: PackageProvider.Data) => {
		// name 缺省（全局设置条目）时市场数据里查不到对应包，走 manifest 兜底
		const category =
			store.market?.data[name ?? ""]?.category ||
			manifest?.category;
		return (
			active.value === "all" ||
			resolveCategory(category) === active.value
		);
	},
);
</script>
