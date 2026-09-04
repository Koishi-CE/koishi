<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  控制台根组件：活动栏 + 路由页面（keep-alive 缓存） + 状态栏 + 全局菜单层。
  路由声明了所需 store 字段（route.meta.activity.fields）时，
  等全部字段就绪才渲染页面，期间显示全屏 loading。
-->
<template>
  <activity-bar></activity-bar>
  <router-view v-if="loaded" #="{ Component }">
    <keep-alive>
      <component :is="Component"></component>
    </keep-alive>
  </router-view>
  <div class="loading" v-else v-loading="true" :element-loading-text="t('loading.data')"></div>
  <status-bar></status-bar>
  <menu-list></menu-list>
</template>

<script lang="ts" setup>
import { store } from "@koishi-ce/client";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import ActivityBar from "./activity/index.vue";
import MenuList from "./menu/index.vue";
import StatusBar from "./status.vue";

const { t } = useI18n();
const route = useRoute();

// 页面就绪判定：未声明所需字段的页面恒为已就绪；
// 否则要求 meta.activity.fields 中每个 store 字段都有数据
const loaded = computed(() => {
	if (!route.meta.activity?.fields) return true;
	return route.meta.activity.fields.every(
		(key) => store[key],
	);
});
</script>
