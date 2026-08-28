/**
 * @file 市场推荐排序的打分体系(market 域)。
 *
 * getRecommendScore 六维加权(下载量/维护/新鲜度/信任/质量/探索)算出
 * 0-100 的推荐分,叠加风险乘数(insecure/deprecated/preview 降权)与
 * 已装条目降权;分值打平时回退到下载量/更新时间/创建时间/包名比较。
 */

import type { SearchObject } from "@koishi-ce/registry";
import type { MarketConfig } from "./context";
import type { MarketSearchIndex } from "./similarity";

function clamp(value: number, min = 0, max = 1) {
	return Math.min(max, Math.max(min, value));
}

function getDaysSince(timestamp: number, now: number) {
	if (!Number.isFinite(timestamp)) return Infinity;
	return Math.max(0, (now - timestamp) / 86400000);
}

function sigmoid(value: number, center: number, steepness: number) {
	return 1 / (1 + Math.exp(-(value - center) * steepness));
}

/** 新鲜度分:创建距今越久越低(单调递减的连续函数,避免分段在 180 天处反弹)。 */
function getFreshnessScore(days: number) {
	if (!Number.isFinite(days)) return 0;
	return Math.exp(-days / 180);
}

function hasPackageLink(data: SearchObject) {
	const links = data.package.links ?? {};
	return !!(links.repository || links.homepage || links.bugs);
}

function getQualityScore(data: SearchObject, index: MarketSearchIndex) {
	const manifestDescription = data.manifest?.description;
	const hasManifestDescription =
		typeof manifestDescription === "string"
			? !!manifestDescription.trim()
			: !!Object.values(manifestDescription ?? {}).some((value) =>
					String(value ?? "").trim(),
				);
	const packageDescription = (
		data.package as SearchObject["package"] & { description?: string }
	).description;
	const keywords = data.package.keywords ?? [];
	const license =
		data.license ||
		(data.package as SearchObject["package"] & { license?: string }).license;
	let score = 0;
	if (hasManifestDescription) score += 0.22;
	if (packageDescription?.trim()) score += 0.18;
	if (index.category && index.category !== "other") score += 0.14;
	if (keywords.length >= 3) score += 0.12;
	if (data.package.maintainers?.length) score += 0.1;
	if (license) score += 0.08;
	if (!index.bundle) score += 0.08;
	return clamp(score);
}

function getTrustScore(data: SearchObject) {
	let score = 0;
	if (data.verified) score += 0.55;
	if (data.portable) score += 0.15;
	if (hasPackageLink(data)) score += 0.1;
	return clamp(score);
}

function getExplorationScore(
	downloads: number,
	maintenance: number,
	quality: number,
) {
	const lowDownloadBoost = 1 - sigmoid(Math.log10(downloads + 1), 2.2, 1.25);
	const recentBoost = maintenance;
	const qualityFloor = clamp((quality - 0.35) / 0.65);
	return clamp(lowDownloadBoost * recentBoost * qualityFloor);
}

function getRiskMultiplier(data: SearchObject) {
	if (data.insecure || data.manifest?.insecure) return 0.15;
	if (
		(data as SearchObject & { deprecated?: unknown }).deprecated ||
		data.package.deprecated
	)
		return 0.25;
	if (data.manifest?.preview === true) return 0.6;
	return 1;
}

function getRecommendScore(
	data: SearchObject,
	index: MarketSearchIndex,
	config: MarketConfig | undefined,
	now: number,
) {
	const downloads = Math.max(0, data.downloads?.lastMonth ?? 0);
	const updatedDays = getDaysSince(index.updatedTimestamp, now);
	const createdDays = getDaysSince(index.createdTimestamp, now);
	const popularity = sigmoid(Math.log10(downloads + 1), 2.6, 1.15);
	const maintenance = Number.isFinite(updatedDays)
		? Math.exp(-updatedDays / 120)
		: 0;
	const freshness = getFreshnessScore(createdDays);
	const trust = getTrustScore(data);
	const quality = getQualityScore(data, index);
	const exploration = getExplorationScore(downloads, maintenance, quality);
	let score =
		100 *
		(0.3 * popularity +
			0.24 * maintenance +
			0.16 * freshness +
			0.12 * trust +
			0.1 * quality +
			0.08 * exploration);
	score *= getRiskMultiplier(data);
	if (config?.installed?.(data)) score *= 0.18;
	return score;
}

export function compareRecommendFallback(a: SearchObject, b: SearchObject) {
	const downloadDelta =
		(b.downloads?.lastMonth ?? 0) - (a.downloads?.lastMonth ?? 0);
	if (downloadDelta) return downloadDelta;
	const updatedDelta = b.updatedAt.localeCompare(a.updatedAt);
	if (updatedDelta) return updatedDelta;
	const createdDelta = b.createdAt.localeCompare(a.createdAt);
	if (createdDelta) return createdDelta;
	return a.package.name.localeCompare(b.package.name);
}

export { getRecommendScore };
