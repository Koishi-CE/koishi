<template>
  <el-dialog v-if="store.market?.registry" v-model="showConfirm" :class="'confirm-panel'" destroy-on-close>
    <template #header>{{ t('operations.confirm.title') }}</template>
    <!-- 变更表格:逐行列出 依赖 / 旧版本 → 新版本(空串显示为"移除依赖") -->
    <div class="confirm-change-list">
      <table>
        <colgroup>
          <col width="auto">
          <col width="auto">
          <col width="1rem">
          <col width="auto">
        </colgroup>
        <thead>
          <tr>
            <th>{{ t('operations.confirm.dependency') }}</th>
            <th>{{ t('operations.confirm.oldVersion') }}</th>
            <th></th>
            <th>{{ t('operations.confirm.newVersion') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(version, name) in overrides" :key="name">
            <td>{{ name }}</td>
            <td>{{ store.dependencies?.[name]?.resolved || t('operations.confirm.notInstalled') }}</td>
            <td class="arrow"><span><k-icon name="arrow-right"></k-icon></span></td>
            <td>{{ version || t('operations.confirm.removeDependency') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <template #footer>
      <!-- 操作栏:左侧"移除配置"勾选(仅有卸载项时可用),右侧丢弃/应用 -->
      <div class="left">
        <el-checkbox :disabled="!hasRemove" v-model="removeConfig">
          {{ t('operations.confirm.removeConfig') }}
        </el-checkbox>
      </div>
      <div class="right">
        <el-button type="danger" @click="clear">{{ t('operations.confirm.discard') }}</el-button>
        <el-button type="primary" @click="confirm">{{ t('operations.confirm.apply') }}</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
/**
 * @file 依赖变更确认对话框。
 *
 * 批量（bulk）模式下,市场页/依赖页攒下的 override 清单与合包成员卸载队列
 * 在这里做最后确认:表格逐行展示"旧版本 → 新版本(空串代表卸载)",用户拍板
 * 后交给 shared/operations 的 install() 统一执行;成功回调里再按需清理合包
 * 分组配置与插件配置。由 app/pages.ts 全局挂载,开关是 shared/operations
 * 导出的 showConfirm。
 */

import { computed, ref } from "vue";
import { message, send, store, useContext, useConfig } from "@koishi-ce/client";
import {
	ensureInstalledConfigs,
	getConfigWriter,
	showConfirm,
	install,
	pendingBundleUninstalls,
	MARKET_NEXT_PACKAGE,
} from "../../shared/operations";
import {
	getPendingOverrides,
	getRemoveConfig,
	getWritableBundleRecords,
	patchMarketNextData,
} from "../../shared/plugin-config";
import { useMarketNextI18n } from "../../shared/i18n";

const ctx = useContext();
const config = useConfig();
const { t } = useMarketNextI18n();
/** 待应用的覆盖清单:包名 → 版本请求(空串代表卸载),来自 marketData.override。 */
const overrides = computed(() => getPendingOverrides());

/** "同时移除插件配置"勾选状态,初始值取用户上次保存的选择(未保存过则默认未勾)。 */
const removeConfig = ref(getRemoveConfig(config.value));

/** 丢弃全部待应用变更:清空 override 与合包卸载队列并落库。 */
function clear() {
	showConfirm.value = false;
	const override = getPendingOverrides();
	for (const key of Object.keys(override)) delete override[key];
	void patchMarketNextData({ override: { ...override } });
	pendingBundleUninstalls.value = {};
}

/** 清单里是否存在卸载项(版本为空串):决定"移除配置"勾选框是否可用。 */
const hasRemove = computed(() => {
	return Object.values(overrides.value).some((version) => !version);
});

/**
 * 确认执行:把 override 交给 install(),成功回调里依次完成——
 * 1. 为仍要安装的包补齐 koishi.yml 配置节点(ensureInstalledConfigs);
 * 2. 对标记 cleanup 的合包调 remove-bundle-configs 清掉组内成员配置;
 * 3. 勾了"移除配置"时删除被卸载包的配置(合包与合包成员除外,它们的配置
 *    已经由第 2 步按成员粒度处理);
 * 4. 清空 override 与对应合包记录并落库。
 * 覆盖清单里含本插件包名时按"自更新"场景传专属文案。
 */
// 批量变更应用的成块编排:四步收尾同属一次安装的生命周期,拆分会打散配对
// fallow-ignore-next-line complexity
function confirm() {
	showConfirm.value = false;
	const override = { ...overrides.value };
	const selfUpdate = Object.prototype.hasOwnProperty.call(
		override,
		MARKET_NEXT_PACKAGE,
	);
	const removed = Object.entries(override)
		.filter(([, value]) => !value)
		.map(([name]) => name);
	// 只保留本次真的要卸载的合包(用户可能在队列外又改了主意)
	const bundleRemovals = Object.fromEntries(
		Object.entries(pendingBundleUninstalls.value).filter(([name]) =>
			removed.includes(name),
		),
	);
	const bundlePackages = new Set(Object.keys(bundleRemovals));
	const bundleMembers = new Set(
		Object.values(bundleRemovals).flatMap((item) => item.members ?? []),
	);
	// 批量变更应用回调:安装/卸载/合包清理三路收尾编排,分支各自对应一类变更
	// fallow-ignore-next-line complexity
	return install(
		override,
		async () => {
			const installNames = Object.entries(override)
				.filter(([, value]) => value)
				.map(([name]) => name)
				.filter((name) => name !== MARKET_NEXT_PACKAGE);
			await ensureInstalledConfigs(ctx, installNames, true);
			for (const [name, item] of Object.entries(bundleRemovals)) {
				if (!item.cleanup) continue;
				await send("market/remove-bundle-configs", {
					package: name,
					members: item.configs,
					removeEmptyGroup: true,
				});
			}
			if (removeConfig.value) {
				for (const name of removed) {
					if (bundlePackages.has(name) || bundleMembers.has(name)) continue;
					getConfigWriter(ctx)?.remove(name);
				}
			}
			for (const name of removed) {
				delete getWritableBundleRecords(config.value)[name];
				delete pendingBundleUninstalls.value[name];
			}
			for (const key of Object.keys(getPendingOverrides()))
				delete getPendingOverrides()[key];
			const saved = await patchMarketNextData({
				override: {},
				bundleRecords: getWritableBundleRecords(config.value),
			});
			if (!saved) message.warning(t("operations.confirm.saveBundleFailed"));
		},
		undefined,
		selfUpdate
			? {
					loadingText: t("operations.progress.selfUpdateTitle"),
					successText: t("operations.progress.selfSubmittedSuccess"),
					errorText: t("operations.progress.errorSelf"),
					timeoutText: t("operations.progress.installTimeout"),
					selfUpdate: true,
				}
			: undefined,
	);
}
</script>

<style lang="scss" src="./index.scss"></style>
