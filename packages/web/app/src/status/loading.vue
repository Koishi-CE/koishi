<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  页面组件按需加载进度条：按当前路由所需扩展（ctx.$loader.extensions）
  的完成比例显示进度；store.entry 尚未就绪时以不确定进度（indeterminate）展示。
-->
<template>
  <k-status v-if="progress < 1">
    <el-progress :indeterminate="!store.entry" :percentage="progress * 100">
      {{ t('loading.page') }}
    </el-progress>
  </k-status>
</template>

<script lang="ts" setup>
import { store, useContext } from "@koishi-ce/client";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const ctx = useContext();
const { t } = useI18n();

const progress = computed(() => {
	const states = Object.values(ctx.$loader.extensions);
	return (
		states.filter((state) => state.done.value).length /
		states.length
	);
});
</script>
