/**
 * @file 依赖卡片的状态机文案 composable(dependencies 域)。
 *
 * 由状态判定族推导卡片的状态类别(statusClass)、徽章文案与图标、
 * 当前/目标版本文案与状态明细文案——依赖页 11 态的展示核心。
 */

import { type ComputedRef, computed } from "vue";
import { endpointHost } from "../../shared/format";
import { getRegistryStatusText } from "../../shared/operations";
import { getUpdateIgnoreText } from "../../shared/plugin-config";
import type { PackageCardState } from "./use-package-card-state";

export function usePackageCardStatus(
	state: PackageCardState,
	t: (key: string, ...args: any[]) => string,
	editing: ComputedRef<boolean>,
) {
	// 状态到样式类的优先级映射,11 态判定链是数据驱动的查表场景
	// fallow-ignore-next-line complexity
	const statusClass = computed(() => {
		if (state.pending.value) return "pending";
		if (state.localDependency.value) return "local";
		if (state.dep.value?.invalid) return "invalid";
		if (state.bundlePackage.value && (state.dep.value || state.local.value))
			return "bundle";
		if (state.unconfigured.value) return "unconfigured";
		if (state.status.value?.error) return "error";
		if (!state.dep.value && !state.local.value) return "manual";
		if (state.updateCheckDisabled.value) return "check-disabled";
		if (state.ignoredUpdate.value) return "ignored";
		if (state.updatable.value) return "updatable";
		return state.kind ?? "installed";
	});

	// 状态到徽章文案的优先级映射,各映射间的判定顺序互不相同,不宜强行合并成统一状态机
	// fallow-ignore-next-line complexity
	const statusLabel = computed(() => {
		if (state.pendingRemove.value)
			return t("dependencyCard.status.pendingRemove");
		if (state.pending.value && state.dep.value)
			return t("dependencyCard.status.pendingApply");
		if (state.pending.value) return t("dependencyCard.status.pendingInstall");
		if (state.localDependency.value) return t("dependencyCard.status.local");
		if (state.dep.value?.invalid) return t("dependencyCard.status.unsupported");
		if (state.bundlePackage.value && (state.dep.value || state.local.value))
			return t("dependencyCard.status.bundle");
		if (state.unconfigured.value)
			return t("dependencyCard.status.unconfigured");
		if (state.status.value?.error)
			return t("dependencyCard.status.versionError");
		if (!state.dep.value && !state.local.value)
			return t("dependencyCard.status.manual");
		if (state.updateCheckDisabled.value)
			return t("dependencyCard.status.checkDisabled");
		if (state.ignoredUpdate.value) return t("dependencyCard.status.ignored");
		if (state.updatable.value) return t("dependencyCard.status.updatable");
		return t("dependencyCard.status.installed");
	});

	// 状态到图标的优先级映射,与 statusLabel 的判定顺序存在有意差异,保持独立链
	// fallow-ignore-next-line complexity
	const statusIcon = computed(() => {
		if (state.pendingRemove.value) return "close";
		if (state.pending.value) return "tag";
		if (state.bundlePackage.value && (state.dep.value || state.local.value))
			return "file-archive";
		if (state.unconfigured.value) return "preview";
		if (state.dep.value?.invalid) return "insecure";
		if (state.status.value?.error) return "insecure";
		if (state.localDependency.value) return "file-archive";
		if (!state.dep.value) return "search";
		if (state.updateCheckDisabled.value) return "installed";
		if (state.ignoredUpdate.value) return "installed";
		if (state.updatable.value) return "asc";
		return "installed";
	});

	const badgeIcon = computed(() => statusIcon.value);

	const currentText = computed(() => {
		if (!state.dep.value)
			return (
				state.local.value?.package.version ??
				t("dependencyCard.current.notInstalled")
			);
		if (state.localDependency.value)
			return state.dep.value.resolved
				? `${state.dep.value.resolved} / ${t("dependencyCard.current.local")}`
				: t("dependencyCard.current.local");
		return state.dep.value.resolved ?? t("dependencyCard.current.installError");
	});

	// 状态到目标版本文案的映射,含动态取值与状态文案回退
	// fallow-ignore-next-line complexity
	const targetText = computed(() => {
		if (state.pendingRemove.value) return t("dependencyCard.target.remove");
		if (state.overrideValue.value) return state.overrideValue.value;
		if (state.updatable.value && state.latestVersion.value)
			return state.latestVersion.value;
		if (state.ignoredUpdate.value && state.latestVersion.value)
			return state.latestVersion.value;
		if (state.localDependency.value)
			return t("dependencyCard.target.keepLocal");
		if (
			statusClass.value === "installed" &&
			state.dep.value &&
			!state.dep.value.local &&
			!state.dep.value.workspace
		) {
			if (state.dep.value.latest) return state.dep.value.latest;
			if (state.status.value?.loading)
				return t("dependencyCard.target.loading");
		}
		if (state.latestVersion.value) return state.latestVersion.value;
		return state.dep.value || state.local.value
			? t("dependencyCard.target.waitingData")
			: t("dependencyCard.target.waitingInstall");
	});

	const targetLabel = computed(() => {
		if (state.pending.value) return t("dependencyCard.label.pending");
		if (state.updatable.value) return t("dependencyCard.label.latest");
		if (state.ignoredUpdate.value) return t("dependencyCard.label.ignored");
		if (state.dep.value || state.local.value)
			return t("dependencyCard.label.latest");
		return t("dependencyCard.label.target");
	});

	// 状态到明细文案的映射,含 i18n 参数与外部取值函数的动态文案
	// fallow-ignore-next-line complexity
	const detailText = computed(() => {
		if (state.pendingRemove.value)
			return t("dependencyCard.detail.pendingRemove");
		if (state.pending.value && state.dep.value)
			return t("dependencyCard.detail.pendingApply");
		if (state.pending.value) return t("dependencyCard.detail.pendingInstall");
		if (state.localDependency.value) {
			if (!state.dep.value) return t("dependencyCard.detail.localDiscovered");
			return state.dep.value.bound === false
				? t("dependencyCard.detail.localUnbound")
				: t("dependencyCard.detail.local");
		}
		if (state.dep.value?.invalid) return t("dependencyCard.detail.unsupported");
		if (state.bundlePackage.value && (state.dep.value || state.local.value))
			return t("dependencyCard.detail.bundle");
		if (state.unconfigured.value)
			return t("dependencyCard.detail.unconfigured");
		if (state.status.value?.error) return getRegistryStatusText(state.name);
		if (!state.data.value && !state.localDependency.value)
			return getRegistryStatusText(state.name);
		if (state.updateCheckDisabled.value)
			return t("dependencyCard.detail.checkDisabled");
		if (state.ignoredUpdate.value)
			return (
				getUpdateIgnoreText(state.name, state.getUpdatePolicy()) ||
				t("dependencyCard.detail.ignored")
			);
		if (state.updatable.value && state.latestVersion.value)
			return t("dependencyCard.detail.foundUpdate", {
				version: state.latestVersion.value,
			});
		return "";
	});

	const compactStatusText = computed(() => {
		if (state.localDependency.value)
			return state.dep.value?.bound === false
				? t("dependencyCard.detail.localUnboundShort")
				: t("dependencyCard.detail.localShort");
		if (state.dep.value?.invalid)
			return t("dependencyCard.detail.unsupportedShort");
		return state.status.value?.loading || !state.status.value
			? t("dependencyCard.detail.fetching")
			: t("dependencyCard.detail.noData");
	});

	// 版本来源端点的文案映射,逐分支回退为空串
	// fallow-ignore-next-line complexity
	const versionSourceText = computed(() => {
		if (statusClass.value === "installed" && !editing.value) return "";
		if (state.localDependency.value) return "";
		if (state.status.value?.endpoint)
			return endpointHost(state.status.value.endpoint);
		if (state.status.value?.loading) return t("dependencyCard.target.loading");
		if (!state.data.value && state.dep.value)
			return t("dependencyCard.target.waiting");
		return "";
	});

	return {
		statusClass,
		statusLabel,
		statusIcon,
		badgeIcon,
		currentText,
		targetText,
		targetLabel,
		detailText,
		compactStatusText,
		versionSourceText,
	};
}
