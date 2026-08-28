/**
 * @file 安装面板的判定与警示文案 composable(install 域)。
 *
 * 当前依赖/已装版本/本地包形态、主按钮禁用与颜色类型(红黄绿叠加
 * deprecated/insecure/跨大版本警告)、registry 拉取状态文案、peer 检查
 * 结论的图标与文案、合包卸载的回放记录。
 */

import { computed } from "vue";
import { store } from "@koishi-ce/client";
import {
	createLocalBundleRecord,
	getRegistryStatus,
	getRegistryStatusText,
	type PeerInfo,
	type ResultType,
} from "../../shared/operations";
import {
	active,
	getBundleRecords,
	getPendingOverrides,
} from "../../shared/plugin-config";
import { parse } from "semver";
import { isBundlePackageName } from "../../../src/shared/bundle";
import { getMarketObject } from "../../market/state";
import type { InstallVersions } from "./use-install-versions";

export function useInstallDecision(
	versionsState: InstallVersions,
	t: (key: string, args?: any) => string,
	bundleUninstallTarget: { value: string },
	config: { value: any },
) {
	const {
		version,
		bulkMode,
		localSelection,
		data,
		getWorkspaceVersion,
		getOverride,
	} = versionsState;

	/** 当前目标包的依赖条目 / 已解析版本 / 本地已加载包。 */
	const dep = computed(() => store.dependencies?.[active.value]);
	const current = computed(() => store.dependencies?.[active.value]?.resolved);
	const local = computed(() => store.packages?.[active.value]);

	/** 目标包的 workspace 版本(非 workspace 包为 undefined)。 */
	const workspace = computed(() => getWorkspaceVersion(active.value));

	/** 主按钮禁用条件:选中版本在 registry 无数据,或与当前依赖的 request 一致且已解析安装。 */
	const unchanged = computed(() => {
		return (
			!data.value?.[version.value] ||
			(version.value === store.dependencies?.[active.value]?.request &&
				!!store.dependencies?.[active.value]?.resolved)
		);
	});

	/** 是否展示"卸载"按钮:已安装,或批量模式下已有待应用的安装项。 */
	const showRemoveButton = computed(() => {
		return (
			current.value ||
			store.dependencies?.[active.value] ||
			(bulkMode.value && getPendingOverrides()[active.value])
		);
	});

	/** 卸载目标为合包时用于回放的记录视图:持久化记录优先,缺则本地推导。 */
	const bundleUninstallRecord = computed(() => {
		const target = bundleUninstallTarget.value;
		if (!target || !isBundlePackageName(target)) return;
		return (
			getBundleRecords(config.value)[target] || createLocalBundleRecord(target)
		);
	});

	/** 目标包 registry 元数据的拉取状态对象(loading/失败原因)。 */
	const registryStatus = computed(() => getRegistryStatus(active.value));

	/** 拉取状态的用户可读文案(加载中/超时/404/网络错误等)。 */
	const registryStatusText = computed(() =>
		getRegistryStatusText(active.value),
	);

	/** 红色警告:选中版本已弃用,或市场条目标记为不安全(insecure)。 */
	const danger = computed(() => {
		if (localSelection.value) return;
		const deprecated =
			store.registry?.[active.value]?.[version.value]?.deprecated;
		if (deprecated)
			return t("operations.install.deprecated", { reason: deprecated });
		if (getMarketObject(active.value)?.insecure) {
			return t("operations.install.insecure");
		}
	});

	/** 黄色警告:跨大版本(0.x 时代跨 minor)升级提示。 */
	const warning = computed(() => {
		if (!version.value || !current.value || localSelection.value) return;
		try {
			const source = parse(current.value);
			const target = parse(version.value);
			if (
				source.major !== target.major ||
				(!source.major && source.minor !== target.minor)
			) {
				return t("operations.install.majorWarning");
			}
		} catch {}
	});

	/** 主按钮的颜色类型:版本分析结果,叠加 deprecated/insecure 与跨版本警告取更严重者。 */
	const result = computed(() => {
		if (!version.value || !data.value?.[version.value]) return;
		const { result } = data.value[version.value];
		if (result === "danger" || danger.value) return "danger";
		if (result === "warning" || warning.value) return "warning";
		return result;
	});

	/** peer 检查结论的图标:蓝 info / 黄叹号 / 红叉 / 绿勾。 */
	function getResultIcon(type: ResultType) {
		switch (type) {
			case "primary":
				return "info-full";
			case "warning":
				return "exclamation-full";
			case "danger":
				return "times-full";
			case "success":
				return "check-full";
		}
	}

	/** peer 检查结论的文案:结合"是否已在覆盖清单/是否已装"区分 待安装/待更新/待移除/已下载/不兼容/未下载/可选 等状态。 */
	// peer 结论到状态文案的分支映射,嵌套三元即"覆盖清单×已装"的查表
	// fallow-ignore-next-line complexity
	function getResultText(peer: PeerInfo, name: string) {
		const isOverriden = name in getOverride();
		const isInstalled = store.packages
			? !!store.packages[name]
			: !!store.dependencies?.[name];
		switch (peer.result) {
			case "primary":
				return isOverriden
					? t("operations.install.waitingRemove")
					: t("operations.install.optional");
			case "danger":
				return peer.resolved
					? t("operations.install.incompatible")
					: isOverriden
						? t("operations.install.waitingRemove")
						: t("operations.install.notDownloaded");
			case "success":
				return isOverriden
					? isInstalled
						? t("operations.install.waitingUpdate")
						: t("operations.install.waitingInstall")
					: t("operations.install.downloaded");
		}
	}

	return {
		dep,
		current,
		local,
		workspace,
		unchanged,
		showRemoveButton,
		bundleUninstallRecord,
		registryStatus,
		registryStatusText,
		danger,
		warning,
		result,
		getResultIcon,
		getResultText,
	};
}
