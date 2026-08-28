<template>
  <!-- navigation -->
  <div class="navigation flex flex-wrap gap-x-4 gap-y-2 my-8" v-if="object || showDependencyUninstall">
    <a class="el-button" target="_blank"
      v-if="object?.package.links.homepage"
      :href="object.package.links.homepage"
    >{{ t('extensions.links.homepage') }}</a>
    <a class="el-button" target="_blank"
      v-if="object?.package.links.npm && local?.package.version"
      :href="object.package.links.npm + '/v/' + local.package.version"
    >{{ t('extensions.links.currentVersion', { version: local.package.version }) }}</a>
    <a class="el-button" target="_blank"
      v-if="object?.package.links.repository"
      :href="object.package.links.repository"
    >{{ t('extensions.links.repository') }}</a>
    <a class="el-button" target="_blank"
      v-if="object?.package.links.bugs"
      :href="object.package.links.bugs"
    >{{ t('extensions.links.issues') }}</a>
    <el-button
      v-if="showDependencyUninstall"
      :class="{ 'dependency-remove-button': !pendingRemove }"
      :loading="uninstalling || loadingBundleRecord"
      @click="pendingRemove ? cancelPendingUninstall() : requestUninstall()"
    >
      {{ pendingRemove ? t('extensions.actions.cancelUninstall') : bundleRecord ? t('extensions.actions.uninstallBundle') : t('extensions.actions.uninstallPlugin') }}
    </el-button>
  </div>

  <!-- latest -->
  <k-comment v-if="updateAvailable && !global.static">
    <p>{{ t('extensions.messages.outdatedPrefix') }}<router-link to="/dependencies">{{ t('extensions.actions.goDependencies') }}</router-link>{{ t('extensions.messages.outdatedSuffix') }}</p>
  </k-comment>

  <!-- deprecated -->
  <k-comment v-if="versions?.[dep?.resolved]?.deprecated" type="danger">
    <p>{{ t('extensions.messages.deprecated', { reason: versions[dep.resolved].deprecated }) }}</p>
  </k-comment>

  <!-- external -->
  <k-comment type="warning" v-if="local && !local.workspace && store.dependencies && !store.dependencies[name]">
    <p>{{ t('extensions.messages.externalLocal') }}</p>
  </k-comment>

  <!-- 卸载询问弹窗:仅卸载 / 卸载并移除配置 -->
  <el-dialog v-model="showUninstallDialog" class="market-extension-uninstall-dialog" :title="t('operations.install.uninstall')" destroy-on-close>
    {{ t('extensions.messages.configQuestion') }}
    <template #footer>
      <el-button @click="showUninstallDialog = false">{{ t('extensions.actions.cancel') }}</el-button>
      <el-button type="primary" @click="uninstallDependency(false)">{{ t('extensions.actions.onlyUninstall') }}</el-button>
      <el-button type="danger" @click="uninstallDependency(true)">{{ t('extensions.actions.uninstallAndRemoveConfig') }}</el-button>
    </template>
  </el-dialog>

  <!-- 合包卸载对话框:目标是合包时卸载按钮转交到这里 -->
  <bundle-uninstall
    v-model="showBundleUninstallDialog"
    :package-name="name"
    :record="bundleRecord"
  ></bundle-uninstall>
</template>

<script lang="ts" setup>
/**
 * @file 插件详情页的导航与卸载扩展(plugin-details 插槽)。
 *
 * 展示 主页/NPM/仓库/issue 外链、可更新提示、弃用警告、"外部本地包"提示,
 * 以及卸载入口:目标是合包时转交 bundle-uninstall 对话框;批量模式只把
 * 卸载暂存进 override(可在此撤销);普通场景弹"是否移除配置"询问后调
 * shared/operations 的 install()。由 extensions/index.ts 注册。
 */

import {
	global,
	message,
	send,
	store,
	useConfig,
	useContext,
} from "@koishi-ce/client";
import type {} from "@koishi-ce/plugin-config";
import { type ComputedRef, computed, inject, ref, watch } from "vue";
import type { PluginBundleRecord } from "../../../src/shared/bundle";
import BundleUninstall from "../../dialogs/bundle-uninstall/index.vue";
import { getMarketObject, loadMarketObjects } from "../../market/state";
import { useMarketNextI18n } from "../../shared/i18n";
import {
	type BundleRecordView,
	createLocalBundleRecord,
	fetchBundleRecord,
	getConfigWriter,
	install,
	pendingBundleUninstalls,
} from "../../shared/operations";
import {
	getBulkMode,
	getBundleRecords,
	getMarketNextPolicy,
	getPendingOverrides,
	getRemoveConfig,
	getWritableBundleRecords,
	hasUpdate,
	patchMarketNextData,
} from "../../shared/plugin-config";

const ctx = useContext();
const config = useConfig();
const { t } = useMarketNextI18n();
/** config 插件注入的当前插件包名。 */
const name = inject<ComputedRef<string>>("plugin:name");
/** 宿主运行所必需的依赖,不提供卸载入口。 */
const protectedDeps = new Set([
	"@koishijs/plugin-console",
	"@koishi-ce/plugin-config",
	"@koishijs/plugin-server",
]);

/** 本地已加载包 / 市场元数据 / 依赖条目 / registry 版本表 / 是否有可用更新。 */
const local = computed(() => store.packages?.[name.value]);
const object = computed(() => getMarketObject(name.value));
const dep = computed(() => store.dependencies?.[name.value]);
const versions = computed(() => store.registry?.[name.value]);
const updateAvailable = computed(() =>
	hasUpdate(name.value, getMarketNextPolicy(config.value)),
);
/** 卸载执行中 / 合包记录拉取中 / 两个弹窗开关 / 远端合包记录。 */
const uninstalling = ref(false);
const loadingBundleRecord = ref(false);
const showUninstallDialog = ref(false);
const showBundleUninstallDialog = ref(false);
const remoteBundleRecord = ref<BundleRecordView>();

/** 切换目标插件时拉取其市场元数据。 */
watch(
	name,
	(value) => {
		if (!value) return;
		void loadMarketObjects([value]).catch((error) => {
			console.error(
				"[market-next] failed to load plugin market metadata",
				error,
			);
		});
	},
	{ immediate: true },
);

/** 批量模式下该包是否已暂存为待卸载(override 里值为空串)。 */
const pendingRemove = computed(() => {
	const override = getPendingOverrides();
	return Object.hasOwn(override, name.value) && !override[name.value];
});

/** 该包在 koishi.yml 是否已有配置节点。 */
const hasConfigEntries = computed(() => {
	return !!getConfigWriter(ctx)?.get(name.value)?.length;
});

/** 合包记录视图:持久化记录 > 远端记录 > 本地推导(非合包为 undefined)。 */
const bundleRecord = computed<
	BundleRecordView | PluginBundleRecord | undefined
>(() => {
	const stored = getBundleRecords(config.value)[name.value];
	if (stored) return stored;
	if (remoteBundleRecord.value?.package === name.value)
		return remoteBundleRecord.value;
	return createLocalBundleRecord(name.value);
});

/** 是否展示卸载按钮:静态构建/受保护依赖/workspace 包不显示;已暂存卸载、或在依赖表/本地包中才显示。 */
const showDependencyUninstall = computed(() => {
	if (global.static || protectedDeps.has(name.value)) return false;
	if (local.value?.workspace || dep.value?.workspace) return false;
	if (pendingRemove.value) return true;
	if (store.dependencies) return !!dep.value;
	return !!local.value;
});

/** 取批量模式共享的待应用覆盖清单(marketData.override)。 */
function ensureOverride() {
	return getPendingOverrides();
}

/**
 * 卸载入口分流:合包 → 先拉远端记录再弹 bundle-uninstall 对话框;
 * 批量模式 → 暂存进 override;普通 → 已有配置且无保存偏好时弹询问,
 * 否则直接执行 uninstallDependency。
 */
async function requestUninstall() {
	if (!name.value || uninstalling.value) return;
	if (bundleRecord.value) {
		await loadRemoteBundleRecord();
		showBundleUninstallDialog.value = true;
		return;
	}
	if (getBulkMode(config.value)) {
		const override = ensureOverride();
		override[name.value] = "";
		void patchMarketNextData({ override: { ...override } });
		message.success(t("extensions.messages.stagedUninstall"));
		return;
	}
	const savedRemoveConfig = getRemoveConfig(config.value);
	if (hasConfigEntries.value && typeof savedRemoveConfig !== "boolean") {
		showUninstallDialog.value = true;
		return;
	}
	return uninstallDependency(savedRemoveConfig === true);
}

/** 拉取远端合包记录:已有持久化记录或已拉到有效记录时跳过;失败只告警(还有本地推导兜底)。 */
async function loadRemoteBundleRecord() {
	if (!name.value || getBundleRecords(config.value)[name.value]) return;
	if (
		remoteBundleRecord.value?.package === name.value &&
		remoteBundleRecord.value.members.length
	)
		return;
	loadingBundleRecord.value = true;
	try {
		const record = await fetchBundleRecord(name.value);
		if (record) remoteBundleRecord.value = record;
	} catch (error) {
		console.warn(error);
		message.warning(t("extensions.messages.bundleRecordFailedShort"));
	} finally {
		loadingBundleRecord.value = false;
	}
}

/** 撤销批量模式下暂存的卸载:连同该合包的成员卸载项一并清出 override 与队列。 */
function cancelPendingUninstall() {
	const pendingBundle = pendingBundleUninstalls.value[name.value];
	const override = ensureOverride();
	delete override[name.value];
	for (const member of pendingBundle?.members ?? []) {
		delete override[member];
	}
	void patchMarketNextData({ override: { ...override } });
	delete pendingBundleUninstalls.value[name.value];
	message.success(t("extensions.messages.cancelUninstall"));
}

/** 执行卸载:install() 传空串版本;成功回调里按需移除配置并清掉合包持久化记录。 */
async function uninstallDependency(removeConfig: boolean) {
	if (!name.value || uninstalling.value) return;
	showUninstallDialog.value = false;
	uninstalling.value = true;
	try {
		await install(
			{ [name.value]: "" },
			async () => {
				if (removeConfig) getConfigWriter(ctx)?.remove(name.value);
				const records = getWritableBundleRecords(config.value);
				delete records[name.value];
				const saved = await patchMarketNextData({ bundleRecords: records });
				if (!saved)
					message.warning(t("extensions.messages.bundleRecordFailed"));
			},
			undefined,
			{
				loadingText: t("operations.install.uninstalling"),
				successText: t("operations.install.uninstalled"),
				errorText: t("operations.install.uninstallFailed"),
				timeoutText: t("operations.install.uninstallTimeout"),
			},
		);
	} finally {
		uninstalling.value = false;
	}
}
</script>

<style lang="scss" scoped src="./index.scss"></style>
