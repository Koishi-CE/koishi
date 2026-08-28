/**
 * @file 更新忽略(update ignore)策略族(shared/plugin-config 域)。
 *
 * 基于 src/shared/update 的共享逻辑,判断某包的新版本是否被用户显式忽略:
 * 候选版本从 registry 元数据筛出(本地依赖无候选),再按忽略规则的
 * 次数/时长/精确版本过滤,驱动依赖卡片的"可升级/已忽略"状态。
 */

import { store } from "@koishi-ce/client";
import { gt } from "semver";
import { translate } from "../i18n";
import {
	getUpdateCandidates as getSharedUpdateCandidates,
	isUpdateCheckDisabled,
	isUpdateVersionIgnored,
	normalizeUpdateIgnoreCount,
	normalizeUpdateIgnoreRule,
} from "../../../src/shared/update";
import { isLocalDependency } from "../../../src/shared/dependency-source";
import type {
	IgnoredUpdates,
	UpdateIgnoreRule,
} from "../../../src/shared/update";

export type {
	IgnoredUpdates,
	UpdateIgnoreRule,
} from "../../../src/shared/update";

export { isUpdateCheckDisabled };

/** 创建忽略规则时的附加选项(覆盖策略里的默认时长/次数)。 */
export interface UpdateIgnoreOptions {
	duration?: number;
	count?: number;
}

/** 更新策略:忽略记录 + 三个全局开关(哪些包禁检/忽略时长/忽略版本数/预发布)。 */
export interface UpdatePolicy {
	updateIgnored?: IgnoredUpdates;
	updateIgnoredPackages?: string;
	updateIgnoreDuration?: number;
	updateIgnoreVersions?: number;
	updateIgnorePrerelease?: boolean;
}

/**
 * 为某包创建"忽略此更新"规则:目标是当前最新的未忽略版本,时长/次数
 * 先取本次 options,缺省回落到策略里的全局配置。取不到版本返回 undefined。
 */
export function createUpdateIgnoreRule(
	name: string,
	policy?: UpdatePolicy,
	options: UpdateIgnoreOptions = {},
): UpdateIgnoreRule | undefined {
	const version = getLatestVersion(name, policy);
	if (!version) return;
	const duration = Math.max(
		0,
		options.duration ?? policy?.updateIgnoreDuration ?? 0,
	);
	const count = normalizeUpdateIgnoreCount(
		options.count ?? policy?.updateIgnoreVersions,
	);
	const now = Date.now();
	return {
		version,
		count,
		ignoredAt: now,
		until: duration ? now + duration : undefined,
	};
}

/** 某包当前应升级到的版本:更新候选里第一个未被忽略的(候选已按版本降序)。 */
export function getLatestVersion(name: string, policy?: UpdatePolicy) {
	const candidates = getUpdateCandidates(name, policy);
	return candidates.find(
		(version) => !isUpdateVersionIgnored(name, version, candidates, policy),
	);
}

/** 最新版本恰好被忽略时返回该版本(用于"已忽略"标记),否则 undefined。 */
export function getIgnoredUpdateVersion(name: string, policy?: UpdatePolicy) {
	if (isUpdateCheckDisabled(name, policy)) return;
	const latest = getUpdateCandidates(name, policy)[0];
	if (!latest || !isVersionIgnored(name, latest, policy)) return;
	return latest;
}

/** 把忽略规则格式成用户可读文案(忽略的版本 + 剩余次数 + 截止时间)。 */
export function getUpdateIgnoreText(name: string, policy?: UpdatePolicy) {
	const rule = normalizeUpdateIgnoreRule(policy?.updateIgnored?.[name]);
	if (!rule?.version) return "";
	const parts = [translate("common.ignore.version", { version: rule.version })];
	if (rule.count && rule.count > 1)
		parts.push(translate("common.ignore.count", { count: rule.count }));
	if (rule.until)
		parts.push(
			translate("common.ignore.until", {
				time: new Date(rule.until).toLocaleString(),
			}),
		);
	return parts.join(translate("common.ignore.separator"));
}

/** 某包的最新版本是否处于被忽略状态。 */
export function isUpdateIgnored(name: string, policy?: UpdatePolicy) {
	return !!getIgnoredUpdateVersion(name, policy);
}

/** 某包是否有可升级的新版本(最新版比已装的高,且不在忽略之列;本地依赖不算)。 */
export function hasUpdate(name: string, policy?: UpdatePolicy) {
	const latest = getLatestVersion(name, policy);
	const local = store.dependencies?.[name];
	if (!latest || isLocalDependency(local)) return;
	try {
		return gt(latest, local.resolved);
	} catch {}
}

/**
 * 某包的升级候选版本列表:本地依赖(file/link 装的)无候选,其余从
 * registry 元数据的版本号里筛出比已装版本新的,交由共享逻辑排序过滤。
 */
function getUpdateCandidates(name: string, policy?: UpdatePolicy) {
	const local = store.dependencies?.[name];
	if (isLocalDependency(local)) return [];
	return getSharedUpdateCandidates(
		Object.keys(store.registry?.[name] ?? {}),
		local?.resolved,
		policy,
	);
}

/** 指定版本是否被该包的忽略规则覆盖(次数/时长/精确版本匹配)。 */
function isVersionIgnored(
	name: string,
	version: string,
	policy?: UpdatePolicy,
) {
	const candidates = getUpdateCandidates(name, policy);
	return isUpdateVersionIgnored(name, version, candidates, policy);
}
