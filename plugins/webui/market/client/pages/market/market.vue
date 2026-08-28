<template>
  <!-- 市场页模板:加载态/空态/列表/彩蛋多视图切换,分支即页面形态 -->
  <!-- fallow-ignore-next-line complexity -->
  <k-layout main="darker" :class="'page-market'" menu="market">
    <!-- 左侧栏:排序/徽章/高级日期/分类筛选 -->
    <template #left>
      <el-scrollbar>
        <market-filter v-model="words" :data="visibleData"></market-filter>
      </el-scrollbar>
    </template>

    <!-- 加载态:市场索引拉取中;超过 8 秒追加慢加载提示与设置入口 -->
    <div v-if="marketLoading">
      <div class="el-loading-spinner">
        <svg class="circular" viewBox="25 25 50 50">
          <circle class="path" cx="50" cy="50" r="20" fill="none"></circle>
        </svg>
        <p class="el-loading-text">{{ t('marketPage.loading.title') }}</p>
        <p class="market-loading-detail">{{ t('marketPage.loading.registry', { value: loadingEndpoint }) }}</p>
      </div>
      <k-comment v-if="loadingSlow" type="warning" class="market-loading-warning">
        <p>{{ t('marketPage.loading.slow') }}</p>
        <p>
          {{ t('marketPage.loading.registry', { value: loadingEndpoint }) }}
          <template v-if="loadingTimeout"> · {{ t('marketPage.loading.timeoutLabel', { value: loadingTimeout }) }}</template>
          <template v-if="loadingAutoRoute"> · {{ t('marketPage.loading.autoRoute') }}</template>
        </p>
        <p style="margin-top: 0.5rem;">
          <el-button type="primary" size="small" @click="router.push('/settings/market')">{{ t('marketPage.loading.openMarketSettings') }}</el-button>
        </p>
      </k-comment>
    </div>

    <!-- 主体:搜索行,命中彩蛋关键词时整页切换为秘密档案,否则渲染列表 -->
    <el-scrollbar ref="root" v-else-if="data.length">
      <div class="market-search-row">
        <market-search ref="searchBox" v-model="words"></market-search>
      </div>
      <market-secret-archive
        v-if="secretSearchMatched"
        :koishi-version="secretArchiveKoishiVersion"
        :market-count="secretArchiveMarketCount"
        :recorded-at="secretArchiveRecordedAt"
      ></market-secret-archive>
      <market-list
        v-else
        v-model="words"
        :data="visibleData"
        visibility-prepared
        :gravatar="marketGravatar"
        :debug="!!store.market.debug"
        @debug="updateClientDebug"
        @update:page="scrollToTop">
        <template #header="{ hasFilter, all, packages }">
          <!-- 统计行:命中数/总数 -->
          <div class="market-hint text-center">
            {{ hasFilter ? t('marketPage.results.filtered', { filtered: packages.length, total: all.length }) : t('marketPage.results.all', { total: all.length }) }}
          </div>
          <!-- 缓存提示:索引已过期(stale)或仍在使用缓存 -->
          <k-comment v-if="showMarketCacheHint && store.market.stale" type="warning" class="market-stale">
            <p>{{ t('marketPage.cache.stale') }}</p>
            <p>
              {{ t('marketPage.registry.label', { value: store.market.registry || t('marketPage.registry.unknown') }) }}
              <template v-if="store.market.error"> · {{ t('marketPage.registry.reason', { value: store.market.error }) }}</template>
            </p>
          </k-comment>
          <k-comment v-else-if="showMarketCacheHint && store.market.cached" type="warning" class="market-stale">
            <p>
              {{ t('marketPage.cache.cached') }}
              <template v-if="store.market.refreshing">{{ t('marketPage.cache.refreshing') }}</template>
            </p>
            <p>
              {{ t('marketPage.registry.label', { value: store.market.registry || t('marketPage.registry.unknown') }) }}
              <template v-if="store.market.cachedAt"> · {{ t('marketPage.cache.cachedAt', { value: formatTime(store.market.cachedAt) }) }}</template>
              <template v-if="store.market.validatedAt"> · {{ t('marketPage.cache.validatedAt', { value: formatTime(store.market.validatedAt) }) }}</template>
            </p>
          </k-comment>
          <!-- 调试面板(开启 debug 时):数据源/体积/压缩比/各阶段耗时/端点评分 -->
          <k-comment v-if="store.market.debug" type="primary" class="market-debug">
            <p>{{ t('marketPage.debug.performance', { source: formatSource(store.market.debug.source), endpoint: store.market.debug.endpoint || store.market.registry || t('marketPage.registry.unknown') }) }}</p>
            <div class="market-debug-grid">
              <span v-for="item in debugItems" :key="item.label" class="market-debug-item">
                <span>{{ item.label }}</span>
                <span>{{ item.value }}</span>
              </span>
            </div>
            <div v-if="debugTimings.length" class="market-debug-timings">
              <span v-for="[key, value] in debugTimings" :key="key">{{ formatTimingName(key) }} {{ formatDuration(value) }}</span>
            </div>
            <div v-if="debugPhases.length" class="market-debug-timings">
              <span v-for="item in debugPhases" :key="item.label">{{ item.label }}: {{ item.value }}</span>
            </div>
            <div v-if="debugRoutes.length" class="market-debug-routes">
              <span v-for="route in debugRoutes" :key="route.endpoint" class="market-debug-route">
                {{ shortEndpoint(route.endpoint) }} score={{ formatScore(route.score) }}
                <template v-if="route.averageElapsed"> avg={{ formatDuration(route.averageElapsed) }}</template>
                <template v-if="route.contentEncoding"> {{ route.contentEncoding }}</template>
                <template v-if="route.cachedAt"> cache={{ formatTime(route.cachedAt) }}</template>
                <template v-if="route.coolingDown"> cooldown={{ formatTime(route.cooldownUntil) }}</template>
              </span>
            </div>
          </k-comment>
        </template>
        <template #action="data">
          <el-button
            solid
            :type="getType(data)"
            @click.stop.prevent="openPackage(data)">
            {{ getText(data) }}
          </el-button>
        </template>
      </market-list>
    </el-scrollbar>

    <!-- 错误态:市场索引加载失败,引导去设置页检查 registry -->
    <k-comment v-else type="danger" class="market-error">
      <p>{{ t('marketPage.error.title') }}</p>
      <p>
        {{ t('marketPage.error.registry', { value: store.market?.registry || loadingEndpoint }) }}
        <template v-if="store.market?.error"> · {{ t('marketPage.error.reason', { value: store.market.error }) }}</template>
      </p>
      <ul>
        <li>{{ t('marketPage.error.networkHint') }}</li>
        <li>{{ t('marketPage.error.searchHint') }}</li>
      </ul>
      <p style="margin-top: 0.8rem;">
        <el-button type="primary" size="small" @click="router.push('/settings/market')">{{ t('marketPage.error.openRegistrySettings') }}</el-button>
      </p>
    </k-comment>
  </k-layout>
</template>

<script setup lang="ts">
/**
 * @file 市场主页面(/market)。
 *
 * 组装页面骨架:左侧筛选栏、顶部搜索框、卡片列表、加载/错误/慢加载
 * 提示、缓存提示与调试面板。快照数据来自 market/state(shallowRef +
 * store 兜底),本页只做静音过滤与可见性过滤,查询词过滤与排序交给
 * market-list 组件;搜索词与 URL ?keyword= 双向同步,Ctrl+K 聚焦搜索。
 *
 * 拆分:数据管线/加载态/URL 同步在 use-market-page,调试面板在
 * use-market-debug(格式化纯函数在 debug-format),彩蛋在 use-market-easter。
 */

import { router, store, global, useConfig } from "@koishi-ce/client";
import { computed, onMounted, onUnmounted, provide, ref } from "vue";
import { active, getPendingOverrides } from "../../shared/plugin-config";
import { kConfig, MarketFilter, MarketList, MarketSearch } from "../../market";
import { SearchObject } from "@koishi-ce/registry";
import { activeBundle } from "../../shared/operations";
import MarketSecretArchive from "./market-secret-archive.vue";
import { canInstallBundleSearchObject } from "../../market/utils";
import { useMarketNextI18n } from "../../shared/i18n";
import {
	formatSource as formatSourceWith,
	formatTimingName as formatTimingNameWith,
	formatTime as formatTimeWith,
} from "./debug-format";
import { useMarketDebug } from "./use-market-debug";
import { useMarketEaster } from "./use-market-easter";
import { installed, useMarketPage } from "./use-market-page";

/** 主滚动容器(滚动回顶用)。 */
const root = ref();
/** 搜索框组件引用(focus 快捷键用)。 */
const searchBox = ref<{ focus?: () => void }>();
const config = useConfig();
const { t, locale } = useMarketNextI18n();
/** gravatar 镜像:插件配置优先,退化为服务端下发的 store.market.gravatar。 */
const marketGravatar = computed(
	() => config.value.market?.gravatar || store.market?.gravatar,
);

// 注入市场配置:静态站点下不提供 installed 判定
provide(kConfig, {
	installed: global.static ? undefined : installed,
});

const page = useMarketPage(config);
const {
	words,
	data,
	visibleData,
	marketLoading,
	loadingSlow,
	loadingEndpoint,
	loadingTimeout,
	loadingAutoRoute,
	showMarketCacheHint,
	loadInitial,
} = page;
const {
	debugItems,
	debugTimings,
	debugPhases,
	debugRoutes,
	updateClientDebug,
} = useMarketDebug(t, locale);
const {
	secretSearchMatched,
	secretArchiveRecordedAt,
	secretArchiveKoishiVersion,
	secretArchiveMarketCount,
} = useMarketEaster(words, data, locale, () => {
	requestAnimationFrame(() => root.value?.scrollTo(0, 0));
});

onMounted(() => {
	loadInitial();
	window.addEventListener("keydown", onSearchShortcut);
});

onUnmounted(() => {
	window.removeEventListener("keydown", onSearchShortcut);
});

/** 全局键盘快捷键:Ctrl/Cmd+K 聚焦搜索框;彩蛋页 Esc 清词并聚焦。 */
// 键盘快捷键守卫链:逐条排除非目标按键,每条守卫即一条快捷键语义
// fallow-ignore-next-line complexity
function onSearchShortcut(event: KeyboardEvent) {
	if (router.currentRoute.value?.path !== "/market") return;
	if (event.key === "Escape" && secretSearchMatched.value) {
		event.preventDefault();
		words.value = [""];
		searchBox.value?.focus?.();
		return;
	}
	if (event.key.toLowerCase() !== "k") return;
	if (!event.ctrlKey && !event.metaKey) return;
	event.preventDefault();
	searchBox.value?.focus?.();
}

/** 卡片操作按钮颜色:已装绿/待操作黄/待卸载红,未装蓝。 */
function getType(data: SearchObject) {
	if (global.static) return "primary";
	const version = getPendingOverrides()[data.package.name];
	if (installed(data)) {
		if (version === "") return "danger";
		if (version) return "warning";
		return "success";
	}
	if (version) return "warning";
	return "primary";
}

/** 卡片操作按钮文案:与 getType 的状态机一一对应。 */
function getText(data: SearchObject) {
	if (global.static) return t("marketPage.actions.config");
	const version = getPendingOverrides()[data.package.name];
	if (installed(data)) {
		if (version === "") return t("marketPage.actions.waitingRemove");
		if (version) return t("marketPage.actions.waitingUpdate");
		return t("marketPage.actions.edit");
	}
	if (version) return t("marketPage.actions.waitingInstall");
	return t("marketPage.actions.addPlugin");
}

/** 打开条目详情:可安装的合包打开合包弹层,普通包设置 active 弹层。 */
function openPackage(data: SearchObject) {
	if (!global.static && canInstallBundleSearchObject(data)) {
		activeBundle.value = data;
		return;
	}
	active.value = data.package.name;
}

/** 滚回列表顶部(翻页时由列表触发)。 */
function scrollToTop() {
	root.value?.scrollTo(0, 0);
}

/** 调试面板格式化桥:注入 t/locale,保持模板调用名不变。 */
function formatTime(value: number) {
	return formatTimeWith(value, locale.value);
}
function formatSource(value?: string) {
	return formatSourceWith(value, t);
}
function formatTimingName(value: string) {
	return formatTimingNameWith(value, t);
}
</script>

<style lang="scss" src="./market.scss"></style>
