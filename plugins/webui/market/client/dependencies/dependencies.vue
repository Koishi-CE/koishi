<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <k-layout main="page-deps" menu="dependencies">
    <!-- 顶部工具栏:过滤下拉(带分类计数)/ 预发布屏蔽 / 搜索框 / 摘要徽标 -->
    <div class="deps-toolbar">
      <el-select v-model="filter" class="deps-filter">
        <el-option
          v-for="option in filterOptions"
          :key="option.value"
          :value="option.value"
          :label="`${option.label} (${option.count})`"
        ></el-option>
      </el-select>
      <button
        :class="['deps-prerelease', { active: blockPrerelease }]"
        :title="t('dependencies.toolbar.blockPreviewHint')"
        @click="togglePrerelease"
      >
        <market-icon name="tag"></market-icon>
        <span>{{ t("dependencies.toolbar.blockPreview") }}</span>
      </button>
      <el-input
        ref="searchInput"
        v-model="keyword"
        clearable
        :placeholder="t('dependencies.toolbar.searchPlaceholder')"
        class="deps-search"
      ></el-input>
      <div class="deps-summary">
        <span v-if="summary.pending" class="primary">
          {{ t("dependencies.filters.pending") }} {{ summary.pending }}
        </span>
        <span v-if="summary.updatable" class="success">
          {{ t("dependencies.filters.updatable") }} {{ summary.updatable }}
        </span>
        <span v-if="summary.error" class="danger">
          {{ t("dependencies.filters.error") }} {{ summary.error }}
        </span>
        <span v-if="summary.fetching" class="loading">
          {{ t("dependencies.toolbar.loading") }}
        </span>
      </div>
    </div>

    <!-- 依赖分组卡片墙:每组可折叠头 + 网格 -->
    <el-scrollbar class="body-container">
      <div class="deps-content">
        <template v-if="visibleGroups.length">
          <section
            v-for="group in visibleGroups"
            :key="group.key"
            :class="['dep-group', group.key]"
          >
            <header role="button" @click.prevent="toggleGroup(group.key)">
              <h2>
                <market-icon :name="groupIcon[group.key] ?? 'installed'"></market-icon>
                <span>{{ t(`dependencies.groups.${group.key}`) }}</span>
              </h2>
              <div class="dep-group-side">
                <span class="dep-group-count">{{ group.items.length }}</span>
                <market-icon :class="['dep-chevron', { collapsed: collapsed[group.key] }]" name="asc"></market-icon>
              </div>
            </header>
            <div v-show="!collapsed[group.key]" class="dep-grid">
              <!-- v-memo:registry 微批推送或过滤重算导致父级重渲时,值未变
                   的卡片直接复用 vnode;卡片自身订阅的响应式数据(版本表/
                   override/懒挂载态)变化不受影响 -->
              <package-view
                v-for="item in group.items"
                :key="item.name"
                v-memo="[item.name, item.kind]"
                :item="item"
                @ignore="onIgnore"
              ></package-view>
            </div>
          </section>
        </template>
        <k-empty v-else>{{ t("dependencies.empty") }}</k-empty>
      </div>
    </el-scrollbar>
  </k-layout>

  <!-- 底部批量应用栏:有待应用变更时浮出 -->
  <div v-if="pendingCount" class="deps-apply-bar">
    <div class="deps-apply-text">
      <strong>{{ t("dependencies.apply.count", { count: pendingCount }) }}</strong>
      <span>{{ t("dependencies.apply.description") }}</span>
    </div>
    <div class="deps-apply-actions">
      <el-button @click="discardChanges">{{ t("dependencies.apply.discard") }}</el-button>
      <el-button type="primary" :loading="applying" @click="applyChanges">
        {{ t("dependencies.apply.apply") }}
      </el-button>
    </div>
  </div>

  <!-- 手动添加依赖对话框(既有功能保留) -->
  <manual-install></manual-install>

  <!-- 页面级单例:忽略更新对话框 -->
  <ignore-update-dialog
    v-if="ignoreTarget"
    :key="ignoreTarget"
    :name="ignoreTarget"
    @close="ignoreTarget = ''"
  ></ignore-update-dialog>

  <!-- 页面级单例:移除配置确认对话框(与市场页详情抽屉共享) -->
  <remove-config-dialog
    v-if="removeDialogNames.length"
    :names="removeDialogNames"
    @confirm="onRemoveConfirm"
    @close="removeDialogNames = []"
  ></remove-config-dialog>
</template>

<script lang="ts" setup>
/**
 * 依赖管理页面(/dependencies 路由主体)。
 *
 * 单向数据流:store.dependencies / store.registry / store.packages /
 * override 暂存区 → items 计算(classify 状态机 + 未配置全集并集)→
 * 分组 / 计数派生 → 卡片墙渲染;展示与动作彻底分离——卡片只写
 * override 暂存区并发事件,批量应用与忽略对话框由页面壳单点持有。
 */

import {
	router,
	store,
	useConfig,
	useContext,
} from "@koishi-ce/client";
import { onKeyStroke } from "@vueuse/core";
import { computed, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import ManualInstall from "../components/manual.vue";
import RemoveConfigDialog from "../components/remove-config-dialog.vue";
import { install } from "../components/utils";
import { MarketIcon } from "../vendor";
import {
	buildGroups,
	type DependencyItem,
	type FilterKey,
	GROUP_ORDER,
	summarize,
} from "./dependency-groups.ts";
import {
	classify,
	decodeOverrideEntry,
	PLUGIN_NAME_PATTERN,
} from "./dependency-helpers.ts";
import IgnoreUpdateDialog from "./ignore-dialog.vue";
import {
	hasUpdate,
	isUpdateIgnored,
	resolveLatest,
} from "./ignore-policy.ts";
import PackageView from "./package.vue";

const { t } = useI18n();
const ctx = useContext();
const config = useConfig();

const keyword = ref("");
const filter = ref<FilterKey>("all");
const searchInput = ref<{ focus?: () => void }>();
const ignoreTarget = ref("");
const applying = ref(false);
/** 待确认「是否同时删除配置」的已配置移除项名单(非空即弹共享对话框) */
const removeDialogNames = ref<string[]>([]);
/** 分组折叠态(会话内记忆,不持久化) */
const collapsed = reactive<Record<string, boolean>>({});

const blockPrerelease = computed(
	() => config.value.market.blockPrerelease ?? false,
);

/** 生效最新版本:优先完整版本表,缺失时退 node 侧已填充的 latest。 */
function effectiveLatestOf(
	name: string,
): string | undefined {
	const versions = Object.keys(
		store.registry?.[name] ?? {},
	);
	if (versions.length) {
		return resolveLatest(versions, blockPrerelease.value);
	}
	const latest = store.dependencies?.[name]?.latest;
	if (!latest) return undefined;
	return resolveLatest([latest], blockPrerelease.value);
}

/** config 插件提供的数据面(store.packages + configWriter)是否可用;
 * 两者同生共死,任一缺席时未配置判定与全集并集整体关闭(降级为现状口径)。 */
const packageInfoAvailable = computed(
	() => !!store.packages && !!ctx.configWriter,
);

/**
 * 未配置判定:本机已下载(paths 无 workspace 配置键)且没有任何
 * 配置节点。调用前提是 packageInfoAvailable 为真。
 */
function isUnconfiguredEntry(name: string): boolean {
	const paths = store.packages?.[name]?.paths;
	if (paths?.length) return false;
	return !ctx.configWriter?.get(name)?.length;
}

/** 全量条目(分类状态机在纯函数里,此处只做数据装配)。 */
const items = computed<DependencyItem[]>(() => {
	const deps = store.dependencies ?? {};
	const override = config.value.market.override ?? {};
	// 快照条目与 override 暂存条目取并集(待装新依赖只在 override 里);
	// 不用 Set 展开写法,规避 vue-tsc 影子环境的 downlevelIteration 键
	const names = Object.keys(deps)
		.concat(
			Object.keys(override).filter(
				(name) => !(name in deps),
			),
		)
		.sort();
	const withConfig = packageInfoAvailable.value;
	const entries = names.map((name) => {
		const dep = deps[name];
		const change = decodeOverrideEntry(override[name]);
		const latest = effectiveLatestOf(name);
		const ignored = isUpdateIgnored(
			config.value.market.ignoreUpdates?.[name],
			latest,
		);
		return {
			name,
			kind: classify(
				dep,
				change,
				ignored,
				hasUpdate(dep?.resolved, latest),
				// 未配置判定(插件名口径是硬门槛,拦下 koishi 本体等非插件依赖)
				withConfig &&
					!!dep &&
					PLUGIN_NAME_PATTERN.test(name) &&
					isUnconfiguredEntry(name),
			),
			ignored,
			fetching: !!dep?.fetching,
		};
	});
	// 全集并集:node_modules 里已下载但未在根声明的未配置插件包
	// (典型是传递依赖)入页;已配置但未声明的包属于配置页视野,
	// 不入页稀释依赖页语义。空名条目是「应用全局设置」占位,排除。
	const packages = store.packages;
	if (!withConfig || !packages) return entries;
	const extras = Object.keys(packages)
		.filter(
			(name) =>
				name &&
				!(name in deps) &&
				!(name in override) &&
				PLUGIN_NAME_PATTERN.test(name) &&
				isUnconfiguredEntry(name),
		)
		.sort()
		.map((name) => ({
			name,
			kind: "unconfigured" as const,
			ignored: false,
			fetching: false,
		}));
	return entries.concat(extras);
});

const summary = computed(() => summarize(items.value));
const visibleGroups = computed(() =>
	buildGroups(items.value, filter.value, keyword.value),
);

const filterOptions = computed(() => [
	{
		value: "all" as const,
		label: t("dependencies.filters.all"),
		count: summary.value.total,
	},
	...GROUP_ORDER.map((kind) => ({
		value: kind,
		label: t(`dependencies.filters.${kind}`),
		count: summary.value[kind],
	})),
]);

/** 各分组头部的图标(vendor 图标注册名)。 */
const groupIcon: Record<string, string> = {
	pending: "tag",
	local: "file-archive",
	invalid: "insecure",
	error: "insecure",
	unconfigured: "download",
	updatable: "asc",
	installed: "installed",
};

function toggleGroup(key: string) {
	collapsed[key] = !collapsed[key];
}

/** 卡片请求打开忽略对话框(页面级单例)。 */
function onIgnore(name: string) {
	ignoreTarget.value = name;
}

function togglePrerelease() {
	config.value.market.blockPrerelease =
		!blockPrerelease.value;
}

/** Ctrl/Cmd+K:仅在依赖页路由上拦截并聚焦搜索框(@vueuse 托管清理)。 */
onKeyStroke("k", (event) => {
	if (!event.ctrlKey && !event.metaKey) return;
	if (router.currentRoute.value?.path !== "/dependencies")
		return;
	event.preventDefault();
	searchInput.value?.focus?.();
});

const pendingCount = computed(
	() =>
		Object.keys(config.value.market.override ?? {}).length,
);

const updatableNames = computed(() =>
	items.value
		.filter((item) => item.kind === "updatable")
		.map((item) => item.name),
);

/**
 * 底部应用栏「应用」:override 暂存区整体交给既有安装链。
 *
 * 应用前批量检查暂存移除项中已配置的插件:存在且 market.removeConfig
 * 偏好未设定(boolean,语义与市场页一致)时弹一次共享确认对话框;
 * 偏好已设定时按偏好直接执行。安装成功回调里按选择对每个移除项
 * 清理配置(config 插件缺席时 configuredNames 恒空,降级为直接移除)。
 */
async function applyChanges() {
	const override = config.value.market.override;
	if (!override || applying.value) return;
	const configuredNames = Object.keys(override)
		.filter((name) => !override[name])
		.filter(
			(name) => !!ctx.configWriter?.get(name)?.length,
		);
	const preference = config.value.market.removeConfig;
	if (
		configuredNames.length &&
		typeof preference !== "boolean"
	) {
		removeDialogNames.value = configuredNames;
		return;
	}
	await doApply(preference === true, configuredNames);
}

/** 确认对话框回调:名单清空后按用户选择继续应用。 */
async function onRemoveConfirm(removeConfig: boolean) {
	const names = removeDialogNames.value;
	removeDialogNames.value = [];
	await doApply(removeConfig, names);
}

/** 实际应用:整体交给安装链,成功回调按选择清理被移除插件的配置。 */
async function doApply(
	removeConfig: boolean,
	configuredNames: string[],
) {
	const override = config.value.market.override;
	if (!override) return;
	applying.value = true;
	try {
		await install({ ...override }, async () => {
			if (!removeConfig) return;
			for (const name of configuredNames)
				ctx.configWriter?.remove(name);
		});
	} finally {
		applying.value = false;
	}
}

/** 底部应用栏「放弃」:清空全部待应用变更。 */
function discardChanges() {
	const override = config.value.market.override;
	if (!override) return;
	for (const key of Object.keys(override))
		delete override[key];
}

/** 页级「全部更新」:把每个可更新包的生效最新版暂存进 override。 */
ctx.action("dependencies.upgrade", {
	disabled: () => !updatableNames.value.length,
	action() {
		const override = (config.value.market.override ??= {});
		for (const name of updatableNames.value) {
			const latest = effectiveLatestOf(name);
			if (latest) override[name] = latest;
		}
	},
});
</script>

<style lang="scss" src="./dependencies.scss"></style>
