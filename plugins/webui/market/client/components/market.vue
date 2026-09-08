<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <k-layout main="darker" class="page-market" menu="market">
    <template #left>
      <el-scrollbar>
        <market-filter v-model="words" :data="getSorted(data, words)"></market-filter>
      </el-scrollbar>
    </template>

    <div v-if="!store.market" class="market-loading">
      <div class="el-loading-spinner">
        <svg class="circular" viewBox="25 25 50 50">
          <circle class="path" cx="50" cy="50" r="20" fill="none"></circle>
        </svg>
        <p class="el-loading-text">正在加载插件市场……</p>
      </div>
      <k-comment v-if="slow" type="warning" class="market-slow">
        <p>市场加载时间过长，这可能是网络波动或 registry 端点响应缓慢导致的。</p>
        <p>你可以稍等片刻，或检查插件市场设置中的 registry 配置后重试。</p>
      </k-comment>
    </div>

    <el-scrollbar ref="root" v-else-if="store.market.total">
      <market-list
        v-model="words"
        :data="data"
        :gravatar="config.market.gravatar || store.market.gravatar"
        @update:page="scrollToTop">
        <template #header="{ hasFilter, all, packages }">
          <market-search v-model="words"></market-search>
          <div class="market-hint text-center">
            共搜索到 {{ hasFilter ? packages.length + ' / ' : '' }}{{ all.length }} 个插件。
          </div>
        </template>
        <template #action="data">
          <el-button
            solid
            :type="getType(data)"
            @click.stop.prevent="active = data.package.name">
            {{ getText(data) }}
          </el-button>
        </template>
      </market-list>
    </el-scrollbar>

    <k-comment v-else type="danger" class="market-error">
      <p>无法连接到插件市场。这可能是以下原因导致的：</p>
      <ul>
        <li>无法连接到网络，请检查你的网络连接和代理设置</li>
        <li>您所用的 registry 不支持搜索功能，请考虑进行更换</li>
      </ul>
      <el-button @click="send('market/refresh')">重新加载</el-button>
    </k-comment>
  </k-layout>
</template>

<script setup lang="ts">
import {
	global,
	router,
	send,
	store,
	useConfig,
} from "@koishi-ce/client";
import type { SearchObject } from "@koishi-ce/registry";
import { getSorted, kConfig } from "@koishijs/market";
import { useTimeoutFn } from "@vueuse/core";
import { computed, provide, ref, watch } from "vue";
import MarketFilter from "../market/filter.vue";
import MarketList from "../market/list.vue";
import MarketSearch from "../market/search.vue";
import { active } from "../utils";

function installed(data: SearchObject) {
	if (store.packages) {
		return !!store.packages[data.package.name];
	} else {
		return !!store.dependencies?.[data.package.name];
	}
}

provide(kConfig, {
	installed: global.static ? undefined : installed,
});

const root = ref();
const config = useConfig();

const words = ref<string[]>([""]);

const prompt = computed(() =>
	words.value.filter((w) => w).join(" "),
);

const data = computed(() =>
	Object.values(store.market?.data || {}),
);

// 加载超 8 秒仍未就绪时给出慢加载提示，避免无限转圈无反馈
const slow = ref(false);
const { start: startSlowTimer, stop: stopSlowTimer } =
	useTimeoutFn(() => (slow.value = true), 8000, {
		immediate: false,
	});
watch(
	() => store.market,
	(value) => {
		stopSlowTimer();
		slow.value = false;
		if (!value) startSlowTimer();
	},
	{ immediate: true },
);

watch(
	router.currentRoute,
	(value) => {
		if (value.path !== "/market") return;
		const { keyword } = value.query;
		if (keyword === prompt.value) return;
		words.value = Array.isArray(keyword)
			? keyword
			: (keyword || "").split(" ");
		words.value = words.value.map((w) => w.toLowerCase());
		if (words.value[words.value.length - 1])
			words.value.push("");
	},
	{ immediate: true, deep: true },
);

watch(
	prompt,
	(value) => {
		const { keyword: _, ...rest } =
			router.currentRoute.value.query;
		if (value) {
			router.replace({
				query: { keyword: value, ...rest },
			});
		} else {
			router.replace({ query: rest });
		}
	},
	{ deep: true },
);

function getType(data: SearchObject) {
	if (global.static) return "primary";
	const version =
		config.value.market.override[data.package.name];
	if (installed(data)) {
		if (version === "") return "danger";
		if (version) return "warning";
		return "success";
	}
	if (version) return "warning";
	return "primary";
}

function getText(data: SearchObject) {
	if (global.static) return "配置";
	const version =
		config.value.market.override[data.package.name];
	if (installed(data)) {
		if (version === "") return "等待移除";
		if (version) return "等待更新";
		return "修改";
	}
	if (version) return "等待安装";
	return "添加";
}

function scrollToTop() {
	root.value?.scrollTo(0, 0);
}
</script>

<style lang="scss">

.page-market .layout-main .el-scrollbar__view {
  padding: 0 var(--card-margin);
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.page-market .layout-left {
  .market-filter-group {
    padding: 0 1rem;
    margin: 1.5rem 0;
  }

  h2 {
    margin: 0;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--k-text-light);
    opacity: 0.7;
    padding: 6px 0.5rem;
  }
}

.market-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1 0 auto;
  min-height: 50vh;
  gap: 2rem;

  .el-loading-spinner {
    margin-top: 0;
  }
}

.market-slow.k-comment {
  max-width: 640px;
}

.market-hint {
  width: 100%;
  margin: 1rem 0 0.75rem;
  color: var(--el-text-color-regular);
  font-size: var(--el-font-size-base);
  font-weight: var(--el-font-weight-primary);
  transition: color 0.3s ease;
}

.market-container {
  .k-button {
    padding: 0.35em 0.85em;
    transform: translateY(-1px);
    margin-left: 1rem;
  }
}

.market-error.k-comment {
  margin-left: 2rem;
  margin-right: 2rem;
}

// 品牌化滚动条：主色调胶囊 thumb（市场页作用域）
.page-market {
  .el-scrollbar__thumb {
    border-radius: 999px;
    border: 2px solid transparent;
    background-clip: content-box;
    background-color: color-mix(in srgb, var(--k-color-primary) 26%, var(--fg3));
    min-height: 32px;

    &:hover {
      background-color: color-mix(in srgb, var(--k-color-primary) 44%, var(--fg3));
    }
  }
}

</style>
