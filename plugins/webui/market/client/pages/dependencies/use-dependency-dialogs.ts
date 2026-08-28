/**
 * @file 依赖页单例对话框编排 composable(dependencies 域)。
 *
 * "忽略此更新"/"本地依赖绑定"/"合包卸载"三个对话框从每张依赖卡片
 * 挪到页面级单例:卡片墙有数百张卡片,对话框组件跟随卡片实例化会乘出
 * 上千份组件 setup 成本。卡片只 emit 打开事件,这里持有目标包状态并
 * 驱动单例挂载(v-if)与打开(ref.open / v-model)。
 */

import { computed, nextTick, ref } from "vue";
import { store } from "@koishi-ce/client";
import {
	getBundleRecords,
	getIgnoredUpdateVersion,
	getLatestVersion,
	getMarketNextPolicy,
	getWritableMarketNextPolicy,
} from "../../shared/plugin-config";
import { createLocalBundleRecord } from "../../shared/operations";
import { formatShortname } from "../../market/utils";
import { getUpdatePolicy } from "./dependency-helpers";
import type { IgnoreUpdateTarget } from "./use-ignore-update";

export function useDependencyDialogs(config: { value: unknown }) {
	/** "忽略此更新"单例:目标包名 + 对话框引用(设置目标后 v-if 挂载)。 */
	const ignoreTargetName = ref("");
	const ignoreDialog = ref<{ open: () => void }>();

	/** 忽略对话框的目标接口(包名 + 更新策略/忽略记录读写)。 */
	const ignoreTarget = computed<IgnoreUpdateTarget | null>(() => {
		const name = ignoreTargetName.value;
		if (!name) return null;
		return {
			name,
			getUpdatePolicy: () => getMarketNextPolicy(config.value as any),
			getUpdateIgnored: () => {
				const policy = getWritableMarketNextPolicy(config.value as any);
				policy.updateIgnored ||= {};
				return policy.updateIgnored;
			},
		};
	});

	/** 忽略对话框展示的短名与最新版本(策略命中 > 已装/本地版本)。 */
	const ignoreDisplayName = computed(() =>
		formatShortname(ignoreTargetName.value),
	);
	const ignoreLatestVersion = computed(() => {
		const name = ignoreTargetName.value;
		if (!name) return "";
		const policy = getUpdatePolicy(config.value);
		return (
			getLatestVersion(name, policy) ||
			getIgnoredUpdateVersion(name, policy) ||
			store.dependencies?.[name]?.latest ||
			store.packages?.[name]?.package.version ||
			""
		);
	});

	/** "本地依赖绑定"单例:目标包名 + 对话框引用。 */
	const bindingTargetName = ref("");
	const bindingDialog = ref<{ open: () => void }>();
	const bindingDisplayName = computed(() =>
		formatShortname(bindingTargetName.value),
	);

	/** "合包卸载"单例:v-model 开关 + 目标包名与合包记录。 */
	const showBundleUninstall = ref(false);
	const bundleUninstallTargetName = ref("");
	const bundleUninstallRecord = computed(() => {
		const name = bundleUninstallTargetName.value;
		if (!name) return undefined;
		return (
			getBundleRecords(config.value as any)[name] ||
			createLocalBundleRecord(name)
		);
	});

	/** 打开"忽略此更新":先设置目标触发 v-if 挂载,nextTick 后调 open 初始化预设。 */
	function openIgnore(name: string) {
		ignoreTargetName.value = name;
		void nextTick(() => ignoreDialog.value?.open());
	}

	/** 打开"本地依赖绑定"。 */
	function openBinding(name: string) {
		bindingTargetName.value = name;
		void nextTick(() => bindingDialog.value?.open());
	}

	/** 打开"合包卸载"。 */
	function openBundleUninstall(name: string) {
		bundleUninstallTargetName.value = name;
		showBundleUninstall.value = true;
	}

	return {
		ignoreTargetName,
		ignoreDialog,
		ignoreTarget,
		ignoreDisplayName,
		ignoreLatestVersion,
		bindingTargetName,
		bindingDialog,
		bindingDisplayName,
		showBundleUninstall,
		bundleUninstallTargetName,
		bundleUninstallRecord,
		openIgnore,
		openBinding,
		openBundleUninstall,
	};
}
