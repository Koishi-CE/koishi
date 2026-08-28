/**
 * @file 依赖页的基础判定层(dependencies 域)。
 *
 * override/更新策略读取入口、可管理合包与未配置判定、单包分类状态机
 * (classify)——被 names 计算与 items/summary 计算共同消费,独立成层
 * 避免相互依赖。
 */

import { type Context, store } from "@koishi-ce/client";
import { isPluginPackage } from "../../market/utils";
import {
	type ClientConfigWriter,
	createLocalBundleRecord,
	getConfigWriter,
	getRegistryStatus,
} from "../../shared/operations";
import {
	getBundleRecords,
	getMarketNextPolicy,
	getPendingOverrides,
	hasUpdate,
	isUpdateCheckDisabled,
	isUpdateIgnored,
} from "../../shared/plugin-config";

/** 依赖条目的分类标签(installed 为兜底态)。 */
export type ItemKind =
	| "pending"
	| "bundle"
	| "unconfigured"
	| "updatable"
	| "ignored"
	| "check-disabled"
	| "invalid"
	| "error"
	| "local"
	| "manual"
	| "installed";

/** 取批量模式共享的待应用覆盖清单(marketData.override)。 */
export function getOverride() {
	return getPendingOverrides();
}

/** 取插件自身的更新策略配置(忽略规则/预发布屏蔽等)。 */
export function getUpdatePolicy(config: unknown) {
	return getMarketNextPolicy(config as any);
}

/** 是否可管理的合包:有持久化安装记录,或可从本地安装状态推导出记录。 */
export function isManageableBundle(name: string, config: unknown) {
	return !!(
		getBundleRecords(config as any)[name] || createLocalBundleRecord(name)
	);
}

/** 是否"未配置"状态:已加载的插件包但 koishi.yml 无配置节点(合包除外)。 */
export function isUnconfigured(
	name: string,
	ctx: Context,
	config: unknown,
	configWriter = getConfigWriter(ctx),
) {
	if (isManageableBundle(name, config)) return false;
	return (
		!!configWriter &&
		!!store.packages?.[name] &&
		isPluginPackage(name) &&
		!configWriter.get(name)?.length
	);
}

/**
 * 单包分类状态机(优先级从高到低):待应用 override > 本地/手动 >
 * 本地形态依赖 > invalid > 可管理合包 > 未配置 > registry 拉取失败 >
 * 禁用更新检查 > 忽略更新 > 可更新 > 已安装。
 */
// 11 态分类状态机的优先级链,顺序即语义,拆分或查表都会掩盖优先级
// fallow-ignore-next-line complexity
export function classify(
	name: string,
	ctx: Context,
	config: unknown,
	configWriter?: ClientConfigWriter,
): ItemKind {
	const dep = store.dependencies?.[name];
	const override = getOverride();
	const pending = Object.hasOwn(override, name);
	if (pending) return "pending";
	if (!dep) return store.packages?.[name] ? "local" : "manual";
	if (dep.local || dep.workspace) return "local";
	if (dep.invalid) return "invalid";
	if (isManageableBundle(name, config)) return "bundle";
	if (isUnconfigured(name, ctx, config, configWriter)) return "unconfigured";
	const status = getRegistryStatus(name);
	if (status?.error) return "error";
	if (isUpdateCheckDisabled(name, getUpdatePolicy(config)))
		return "check-disabled";
	if (isUpdateIgnored(name, getUpdatePolicy(config))) return "ignored";
	if (hasUpdate(name, getUpdatePolicy(config))) return "updatable";
	return "installed";
}
