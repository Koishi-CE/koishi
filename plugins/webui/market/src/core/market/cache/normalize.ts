/**
 * @file 缓存清单的宽容归一(core/market/cache 域)。
 *
 * 职责:把磁盘上任意历史形状(v2/v3 清单、legacy 单条缓存)归一为 v3
 * CacheStore,并对路由统计做数值收敛(clamp/finiteNumber),坏字段静默
 * 丢弃而非整份失败。纯函数,被 persistence.ts 的读取路径消费。
 */
import type { Dict } from "@koishi-ce/koishi";
import { clamp, finiteNumber } from "../../utils/math.js";
import type { CacheEntry, CacheStore, PersistedRouteStats } from "../types.js";

/** 窄化的普通对象判定(排除数组与 null)。 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * 把任意输入归一为 v3 CacheStore:支持 v2/v3 清单(带 entries)、仅路由
 * 统计的清单,以及 legacy 的单条缓存对象。所有分支统一输出 version 3;
 * 完全不认识的结构返回空清单(视为无缓存)。
 */
export function normalizeCacheStore(value: unknown): CacheStore {
	if (isRecord(value)) {
		const { version, entries, lastUsed, routeStats } = value;
		if ((version === 2 || version === 3) && isRecord(entries)) {
			const normalizedEntries: Dict<CacheEntry> = {};
			for (const endpoint in entries) {
				const entry = normalizeCacheEntry(entries[endpoint]);
				if (entry) normalizedEntries[entry.endpoint] = entry;
			}
			return {
				version: 3,
				entries: normalizedEntries,
				lastUsed: lastUsed as string | undefined,
				routeStats: normalizePersistedRouteStats(routeStats),
			};
		}
		// entries 不是对象但 routeStats 有效:保留路由学习成果,索引条目从零开始
		if ((version === 2 || version === 3) && isRecord(routeStats)) {
			return {
				version: 3,
				entries: {},
				lastUsed: lastUsed as string | undefined,
				routeStats: normalizePersistedRouteStats(routeStats),
			};
		}
	}
	const entry = normalizeCacheEntry(value);
	if (entry) {
		return {
			version: 3,
			entries: { [entry.endpoint]: entry },
			lastUsed: entry.endpoint,
		};
	}
	return { version: 3, entries: {} };
}

/** 旧版把索引体内联在主缓存文件里；检测到即触发迁移。 */
export function isLegacyInlineCacheStore(value: unknown) {
	if (!isRecord(value)) return false;
	const { version, entries } = value;
	if (version !== 3) return true;
	return Object.values(entries ?? {}).some((entry) =>
		Array.isArray(
			(entry as { result?: { objects?: unknown } })?.result?.objects,
		),
	);
}

/**
 * 归一路由统计:score 收敛到 [-6, 3],其余数值字段非法即丢弃;
 * 全部条目都无效时返回 undefined(不写空对象,保持清单精简)。
 */
function normalizePersistedRouteStats(
	value: unknown,
): Dict<PersistedRouteStats> | undefined {
	if (!isRecord(value)) return undefined;
	const result: Dict<PersistedRouteStats> = {};
	for (const endpoint in value) {
		const stats = value[endpoint];
		if (!isRecord(stats)) continue;
		const {
			score,
			averageElapsed,
			lastSuccess,
			contentEncoding,
			consecutiveFailures,
			cooldownUntil,
		} = stats;
		const numericScore = Number(score);
		// score 是恢复学习状态的必要字段:缺失/非法则整条丢弃
		if (!Number.isFinite(numericScore)) continue;
		result[endpoint] = {
			score: clamp(numericScore, -6, 3),
			averageElapsed: finiteNumber(averageElapsed),
			lastSuccess: finiteNumber(lastSuccess),
			contentEncoding:
				typeof contentEncoding === "string" ? contentEncoding : undefined,
			consecutiveFailures: finiteNumber(consecutiveFailures),
			cooldownUntil: finiteNumber(cooldownUntil),
		};
	}
	return Object.keys(result).length ? result : undefined;
}

/**
 * 归一单个缓存条目:endpoint 必须是字符串、fetchedAt 必须是有限数,
 * 且至少带一种索引引用(内联 result.objects 或拆分文件名 file),
 * 其余字段按原样透传(结构已由 CacheEntry 类型约束)。
 */
function normalizeCacheEntry(value: unknown): CacheEntry | undefined {
	if (!isRecord(value)) return undefined;
	const { endpoint, fetchedAt: rawFetchedAt } = value;
	const fetchedAt = Number(rawFetchedAt);
	if (typeof endpoint !== "string") return undefined;
	if (!Number.isFinite(fetchedAt)) return undefined;
	if (!hasCacheResultReference(value)) return undefined;
	return { ...(value as CacheEntry), fetchedAt };
}

/** 条目至少要有内联索引体或拆分文件引用之一,否则无法回放。 */
function hasCacheResultReference(value: unknown): value is CacheEntry {
	return (
		Array.isArray(
			(value as { result?: { objects?: unknown } } | undefined)?.result
				?.objects,
		) || typeof (value as { file?: unknown } | undefined)?.file === "string"
	);
}
