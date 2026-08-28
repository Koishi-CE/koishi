/**
 * @file 缓存挑选/评分/淘汰纯函数(core/market/cache 域)。
 *
 * 职责:缓存条目的评分(cacheEntryScore:路由评分打底 + 新鲜度加减分 +
 * 用户首选端点加分)、回放候选构建(buildCacheCandidates:主端点之外的
 * 候选按评分排序)与上限淘汰(pruneCacheEntries:过滤无索引引用与超 TTL
 * 条目,按"lastUsed 最优、用户首选端点次之、评分高者、更新鲜者"排序)。
 *
 * 架构位置:MarketDiskCache.pick/scheduleWrite 的纯计算部分;
 * 条目按 TTL 30 天、最多 3 条淘汰,保证重启后优先回放又快又稳的端点数据。
 */
import type { Dict } from "@koishi-ce/koishi";
import { DAY, HOUR } from "../../utils/time.js";
import {
	type MarketScoreContext,
	marketRouteScore,
} from "../source/endpoints.js";
import type { CacheEntry } from "../types.js";

/** 最多保留的缓存条目数(多端点备份,超出按评分淘汰)。 */
const MAX_CACHE_ENTRIES = 3;
/** 单条缓存的有效期:超过 30 天的条目在 prune 时直接丢弃。 */
const CACHE_ENTRY_TTL = 30 * DAY;

/**
 * 缓存条目评分:路由评分打底,按新鲜度加减分(半天内 +3、3 天内 +1、
 * 更旧 -1),用户配置的首选端点再 +0.5。分高者优先进回放/保留名单。
 */
export function cacheEntryScore(
	cache: CacheEntry,
	context: MarketScoreContext,
) {
	const age = Number.isFinite(cache.fetchedAt)
		? Date.now() - cache.fetchedAt
		: Number.POSITIVE_INFINITY;
	let score = marketRouteScore(cache.endpoint, context);
	if (age <= 12 * HOUR) score += 3;
	else if (age <= 3 * DAY) score += 1;
	else score -= 1;
	if (cache.endpoint === context.config.endpoint) score += 0.5;
	return score;
}

/** 排序比较器:缓存评分降序,并列取更新鲜。 */
function compareByScoreFreshness(
	a: CacheEntry,
	b: CacheEntry,
	context: MarketScoreContext,
) {
	const delta = cacheEntryScore(b, context) - cacheEntryScore(a, context);
	if (delta) return delta;
	return b.fetchedAt - a.fetchedAt;
}

/** 条目是否带可加载的索引引用(内存内联或拆分文件二选一)。 */
function hasIndexRef(entry: CacheEntry | undefined): entry is CacheEntry {
	return !!entry && (Array.isArray(entry.result?.objects) || !!entry.file);
}

/**
 * 构建回放候选(不含主端点):有索引引用的条目按"缓存评分降序、
 * 并列取更新鲜"排序;主端点由调用方优先单独尝试。
 */
export function buildCacheCandidates(
	endpoints: string[],
	entries: Dict<CacheEntry>,
	context: MarketScoreContext,
) {
	return endpoints
		.slice(1)
		.map((endpoint) => entries[endpoint])
		.filter(hasIndexRef)
		.sort((a, b) => compareByScoreFreshness(a, b, context));
}

/**
 * 淘汰并排序条目:过滤掉无索引引用与超过 TTL 的条目,按
 * "lastUsed 最优、用户首选端点次之、评分高者、更新鲜者"排序,
 * 截取 MAX_CACHE_ENTRIES 条返回新的 entries 字典。
 */
export function pruneCacheEntries(
	entries: Dict<CacheEntry>,
	lastUsed: string,
	context: MarketScoreContext,
): Dict<CacheEntry> {
	const preferred = context.config.endpoint;
	const kept = Object.values(entries)
		.filter(
			(entry): entry is CacheEntry =>
				hasIndexRef(entry) && Date.now() - entry.fetchedAt <= CACHE_ENTRY_TTL,
		)
		.sort((a, b) => {
			if (a.endpoint === lastUsed) return -1;
			if (b.endpoint === lastUsed) return 1;
			if (a.endpoint === preferred) return -1;
			if (b.endpoint === preferred) return 1;
			return compareByScoreFreshness(a, b, context);
		})
		.slice(0, MAX_CACHE_ENTRIES);
	return Object.fromEntries(kept.map((entry) => [entry.endpoint, entry]));
}
