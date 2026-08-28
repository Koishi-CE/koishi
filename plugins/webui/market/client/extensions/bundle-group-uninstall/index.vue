<template>
  <bundle-uninstall
    v-model="visible"
    :package-name="packageName"
    :record="record"
    redirect-to-plugins
  ></bundle-uninstall>
</template>

<script setup lang="ts">
/**
 * @file 合包分组卸载的桥接组件(全局插槽)。
 *
 * 监听 bundle-group-uninstall.ts 的 target ref:配置树右键合包分组
 * "卸载合包"时,由分组路径反查合包包名与记录(持久化记录 > 远端拉取 >
 * 本地推导),再复用 dialogs/bundle-uninstall/index.vue 展示。完成后跳转插件页
 * (redirectToPlugins)。由 extensions/index.ts 注册为 global 插槽。
 */

import { computed, ref, watch } from "vue";
import { message, useConfig } from "@koishi-ce/client";
import {
	fetchBundleRecord,
	resolveBundlePackageFromGroup,
	resolveBundleRecordFromGroup,
	type BundleRecordView,
} from "../../shared/operations";
import { getBundleRecords } from "../../shared/plugin-config";
import { bundleGroupUninstallTarget } from "./index.ts";
import BundleUninstall from "../../dialogs/bundle-uninstall/index.vue";
import { useMarketNextI18n } from "../../shared/i18n";

const config = useConfig();
const { t } = useMarketNextI18n();
/** 记录拉取中标记 / 远端拉取到的记录。 */
const loadingBundleRecord = ref(false);
const remoteBundleRecord = ref<BundleRecordView>();

/** 目标分组节点(模块级 ref 的本地只读代理)。 */
const target = computed(() => bundleGroupUninstallTarget.value);
/** 由分组路径反查合包包名:优先匹配持久化记录的 groupKey。 */
const packageName = computed(() => {
	return resolveBundlePackageFromGroup(
		target.value?.path,
		getBundleRecords(config.value),
	);
});
/** 合包记录视图:持久化记录 > 远端记录 > 由分组路径本地推导。 */
const record = computed(() => {
	const name = packageName.value;
	if (!name) return;
	const records = getBundleRecords(config.value);
	const stored = records[name];
	if (stored) return stored;
	if (remoteBundleRecord.value?.package === name)
		return remoteBundleRecord.value;
	return resolveBundleRecordFromGroup(target.value?.path, records);
});

/** 对话框开关代理:target 有值即开,置空 target 即关。 */
const visible = computed({
	get: () => !!bundleGroupUninstallTarget.value,
	set: (value) => {
		if (!value) bundleGroupUninstallTarget.value = undefined;
	},
});

/** 目标变化时清空远端记录;打开对话框且无持久化记录时拉取远端记录兜底。 */
watch(
	target,
	async (value) => {
		remoteBundleRecord.value = undefined;
		if (!value) return;
		await loadRemoteBundleRecord();
	},
	{ immediate: true },
);

/** 拉取远端合包记录:已有持久化记录时跳过;失败只告警不阻断(还有本地推导兜底)。 */
async function loadRemoteBundleRecord() {
	const name = packageName.value;
	if (!name || getBundleRecords(config.value)[name]) return;
	loadingBundleRecord.value = true;
	try {
		const next = await fetchBundleRecord(name);
		if (next) remoteBundleRecord.value = next;
	} catch (error) {
		console.warn(error);
		message.warning(t("extensions.messages.bundleRecordFailedShort"));
	} finally {
		loadingBundleRecord.value = false;
	}
}
</script>

<style lang="scss" scoped src="./index.scss"></style>
