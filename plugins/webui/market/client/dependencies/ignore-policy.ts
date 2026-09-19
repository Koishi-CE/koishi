// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 忽略更新策略与预发布屏蔽的纯函数模块。
 *
 * 零 vue / client 运行时依赖,可被 bun test 直接覆盖;持久化形态
 * (config.market.ignoreUpdates / blockPrerelease)由消费方读写,
 * 本模块只做判定与规则构造。
 */
import { gt, prerelease } from "semver";

/** 单个包的忽略规则(三个维度独立生效): */
export interface IgnoreRule {
	/** 限时忽略的截止时间(epoch ms);窗口内忽略一切更新 */
	until?: number;
	/** 限版本忽略:不高于该版本的更新不再提示(出现更高版本恢复提示) */
	version?: string;
}

/** 判定版本号是否为预发布版本(1.0.0-beta.1 之类)。 */
export function isPrerelease(version: string): boolean {
	try {
		return prerelease(version) !== null;
	} catch {
		return false;
	}
}

/**
 * 计算生效的最新版本:屏蔽预发布时取版本序列中首个稳定版,
 * 全为预发布则视为无可用更新。序列为空时退 undefined。
 */
export function resolveLatest(
	versions: readonly string[],
	blockPrerelease: boolean,
): string | undefined {
	if (!blockPrerelease) return versions[0];
	return versions.find((version) => !isPrerelease(version));
}

/** 判定已装版本是否落后于最新版本(semver 不可解析时视为无更新)。 */
export function hasUpdate(
	resolved: string | undefined,
	latest: string | undefined,
): boolean {
	if (!resolved || !latest) return false;
	try {
		return gt(latest, resolved);
	} catch {
		return false;
	}
}

/**
 * 判定某包的更新提示是否被忽略规则压制:
 * - until 过期后不再压制(限时窗口结束);
 * - 限版本规则只压制不高于该版本的更新;
 * - 无 until 且无 version 视为永久忽略。
 */
export function isUpdateIgnored(
	rule: IgnoreRule | undefined,
	latest: string | undefined,
	now = Date.now(),
): boolean {
	if (!rule) return false;
	if (rule.until !== undefined) {
		return now < rule.until;
	}
	if (rule.version !== undefined && latest !== undefined) {
		try {
			return !gt(latest, rule.version);
		} catch {
			return true;
		}
	}
	return true;
}

/** 忽略对话框的预设选项(对话框据此构造规则)。 */
export type IgnorePreset =
	| "forever"
	| "days7"
	| "days30"
	| "version";

/** 按预设构造忽略规则;version 预设缺目标版本时退永久忽略。 */
export function createIgnoreRule(
	preset: IgnorePreset,
	latest: string | undefined,
	now = Date.now(),
): IgnoreRule {
	switch (preset) {
		case "days7":
			return { until: now + 7 * 86_400_000 };
		case "days30":
			return { until: now + 30 * 86_400_000 };
		case "version":
			return latest ? { version: latest } : {};
		default:
			return {};
	}
}
