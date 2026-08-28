/**
 * @file 索引应用与竞速拉取落盘(core/market/source 域)。
 *
 * 职责:applyMarketIndex 把一份索引应用到内存(过滤 ignored 条目、更新
 * scanner 统计,并按内容 hash 是否变化决定是否递增 dataVersion,revision
 * 无条件递增);fetchAndApplyMarketIndex 竞速拉取 → 应用 → 更新缓存与
 * 调试信息,序号过期则丢弃结果不落盘。
 *
 * 架构位置:从 source/index.ts 同名方法成块搬移,经 MarketApplySource
 * 结构性子集与 MarketIndexSource 解耦;版本计数状态(dataVersion/
 * revision/contentHash)收敛为 counters 对象,由本模块跨文件更新。
 */
import type { SearchResult } from "@koishi-ce/registry";
import type { RouteStatsBook } from "../../racing/stats.js";
import type { MarketWarmupSource } from "../cache/warmup.js";
import type { MarketSnapshotInput } from "../snapshot.js";
import type { EndpointResult } from "../types.js";
import type { MarketScoreContext } from "./endpoints.js";
import { buildMarketFetchDeps, fetchMarketIndex } from "./fetch-index.js";
import { performanceFrom } from "./host.js";
import type { MarketSourceConfig, MarketSourceDeps } from "./types.js";

/**
 * 索引版本计数状态(dataVersion/revision/contentHash 的载体)。
 * dataVersion 只在内容 hash 变化时递增(数据真的变了),revision 每次
 * apply 都递增(展示层刷新依据),两者分工明确。
 */
export interface MarketVersionCounters {
	dataVersion: number;
	revision: number;
	contentHash: string | undefined;
}

/** applyIndex/fetchAndApply 编排所需的源视图（MarketIndexSource 结构性子集）。 */
export interface MarketApplySource extends MarketWarmupSource {
	readonly stats: RouteStatsBook;
	readonly config: MarketSourceConfig;
	/** 版本计数状态(applyMarketIndex 跨文件更新,源侧经 getter 只读暴露) */
	counters: MarketVersionCounters;
	endpoint: string;
	scoreContext(): MarketScoreContext;
	readonly deps: MarketSourceDeps;
	collectError: unknown;
	/** 缓存预热/后台刷新产出的快照载荷(供 getSnapshot 直接返回) */
	payloadValue: MarketSnapshotInput | undefined;
}

/**
 * 应用一份索引到内存:过滤 ignored 条目、更新 scanner 统计,
 * 并按内容 hash 是否变化决定是否递增 dataVersion(展示层用
 * 它判断"数据真的更新了"),revision 无条件递增。
 */
export function applyMarketIndex(
	source: MarketApplySource,
	result: SearchResult,
	endpoint: string,
	contentHash?: string,
) {
	if (!Array.isArray(result?.objects)) {
		throw new Error(`invalid market index from ${endpoint}`);
	}
	source.endpoint = endpoint;
	const ignored = result.objects.filter((object) => object.ignored).length;
	source.scanner.objects = result.objects.filter((object) => !object.ignored);
	source.scanner.total = source.scanner.objects.length;
	source.scanner.version =
		result.version === undefined ? undefined : String(result.version);
	const counters = source.counters;
	if (!contentHash || contentHash !== counters.contentHash)
		counters.dataVersion++;
	counters.revision++;
	counters.contentHash = contentHash;
	source.deps.log.debug(
		`market index applied: endpoint=${endpoint}, version=${result.version ?? "legacy"}, rawObjects=${result.objects.length}, ignored=${ignored}, visible=${source.scanner.total}`,
	);
}

/** 竞速拉取并落盘（collect 的网络部分）。 */
export async function fetchAndApplyMarketIndex(
	source: MarketApplySource,
	serial: number,
	phase: "initial" | "refresh",
): Promise<EndpointResult | undefined> {
	const start = Date.now();
	const result = await fetchMarketIndex(
		buildMarketFetchDeps(source, source.deps) as never,
		serial,
	);
	// 竞速期间序号被推进:结果作废,不应用不落盘
	if (source.scope.isStale(serial)) return undefined;
	const applyStart = Date.now();
	source.applyIndex(result.result, result.endpoint, result.hash);
	result.timings["apply"] = Date.now() - applyStart;
	result.timings["total"] = Date.now() - start;
	source.cache.updateState(result);
	// disk-cache 来源说明数据本来就来自缓存,不必再写回磁盘
	if (result.source !== "disk-cache")
		source.cache.scheduleWrite(result.result, source.cache.meta);
	source.cacheMetaPresent = false;
	source.collectError = undefined;
	// refresh 阶段拿到新数据后清掉旧快照载荷,强制下次 getSnapshot 重建
	if (phase === "refresh") source.payloadValue = undefined;
	source.updateDebugInfo(
		performanceFrom(result, source.scanner.total),
		"refresh",
	);
	return result;
}
