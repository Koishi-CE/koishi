/**
 * @file 端点结果转换、性能调试合并与快照宿主适配(core/market/source 域)。
 *
 * 职责:performanceFrom 把 EndpointResult 转成对外展示的性能快照;
 * mergeMarketPerformance/exportMarketPerformance 是源侧
 * updateDebugInfo/exportedDebug 的纯计算主体;createSourceSnapshotHost
 * 把 MarketIndexSource 的公开状态适配为 snapshot.ts 需要的
 * SnapshotHost 接口(原 source.host())。
 */
import type { Dict } from "@koishi-ce/koishi";
import type {
	MarketPerformance,
	MarketPerformanceSnapshot,
} from "../../../shared/types.js";
import { shortHash } from "../../utils/format.js";
import { assemblePayload, type SnapshotHost } from "../snapshot.js";
import type { EndpointResult } from "../types.js";
import type { MarketIndexSource } from "./index.js";

/** 端点结果 → 性能快照（market debug 卡的数据来源）。 */
export function performanceFrom(
	result: EndpointResult,
	objects: number,
): MarketPerformanceSnapshot {
	return {
		source: result.source,
		endpoint: result.endpoint,
		preferredEndpoint: result.preferredEndpoint,
		fallbackReason: result.fallbackReason,
		candidates: result.candidates,
		size: result.size,
		wireSize: result.wireSize,
		contentEncoding: result.contentEncoding,
		objects,
		hash: shortHash(result.hash),
		etag: result.etag,
		lastModified: result.lastModified,
		cachedAt: result.cachedAt,
		validatedAt: result.validatedAt,
		timings: result.timings,
	};
}

/**
 * 合并更新性能调试信息:timings 按阶段浅合并,phase 归档快照。
 * (MarketIndexSource.updateDebugInfo 的计算主体)
 */
export function mergeMarketPerformance(
	current: MarketPerformance | undefined,
	info: MarketPerformanceSnapshot,
	phase?: "initial" | "refresh",
): MarketPerformance {
	const next: MarketPerformance = {
		...current,
		...info,
		timings: { ...current?.timings, ...info.timings },
	};
	if (phase) next[phase] = { ...info };
	return next;
}

/**
 * logLevel=debug 时才对外暴露 debug 信息,timings 可追加覆盖。
 * (MarketIndexSource.exportedDebug 的计算主体)
 */
export function exportMarketPerformance(
	logLevel: string | undefined,
	current: MarketPerformance | undefined,
	timings?: Dict<number>,
): MarketPerformance | undefined {
	if (logLevel !== "debug") return undefined;
	if (!timings) return current;
	return { ...current, timings: { ...current?.timings, ...timings } };
}

/** 把 MarketIndexSource 适配为 getSnapshot 所需的 SnapshotHost（原 source.host()）。 */
export function createSourceSnapshotHost(
	source: MarketIndexSource,
): SnapshotHost {
	return {
		hasCurrentData: () => source.hasCurrentData(),
		// 本源总是现代版本(带 version 的索引);legacy host 由别处提供
		isModern: () => true,
		endpointLabel: () => source.endpoint,
		fallbackEndpointLabel: () =>
			source.endpoint || source.config.endpoint || "",
		dataVersion: source.dataVersionValue,
		revision: source.revisionValue,
		backgroundRunning: () => !!source.backgroundTask,
		backgroundTask: () => source.backgroundTask,
		warmCacheTask: () => source.warmDiskCacheTask,
		warmCache: (reason) => source.warmDiskCache(reason),
		prepareTask: () => source.prepareTask(),
		scheduleRefreshAfterPrepare: (task) =>
			source.scheduleRefreshAfterPrepare(task),
		buildData: () =>
			Object.fromEntries(
				source.scanner.objects.map((item) => [item.package.name, item]),
			),
		buildPayload: () =>
			assemblePayload(createSourceSnapshotHost(source), {
				refreshing: !!source.backgroundTask,
				// 只有缓存元数据已回放(未被网络刷新覆盖)时才随快照带缓存时间
				cacheMeta:
					source.cacheMetaPresent && source.cache.meta
						? {
								fetchedAt: source.cache.meta.fetchedAt,
								validatedAt: source.cache.meta.validatedAt,
							}
						: undefined,
			}),
		failedCount: () => source.failedCount(),
		scannerTotal: () => source.scanner.total,
		scannerProgress: () => source.scanner.progress,
		payload: () => source.payloadValue,
		setPayload: (payload) => {
			source.payloadValue = payload;
		},
		error: () => source.error,
		debugInfo: (timings) => source.exportedDebug(timings),
		log: source.log,
	};
}
