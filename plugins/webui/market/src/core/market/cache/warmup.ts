/**
 * @file 磁盘缓存预热(core/market/cache 域)。
 *
 * 职责:启动时把磁盘缓存回放进内存索引,让市场列表"秒开",网络刷新
 * 在后台继续。warmDiskCache 单飞去重(并发调用复用同一任务),
 * applyDiskCache 用 RequestScope 序号守卫,防止过期回放覆盖新一轮数据。
 *
 * 架构位置:被 market/source(index 的启动/刷新路径)调用;
 * 通过 MarketWarmupSource 结构性子集与 MarketIndexSource 解耦。
 */
import type { SearchResult } from "@koishi-ce/registry";
import type { MarketPerformanceSnapshot } from "../../../shared/types.js";
import type { RequestScope } from "../../racing/request-scope.js";
import type { ScannerLike } from "../../registry/manifest.js";
import { shortHash } from "../../utils/format.js";
import type { MarketDiskCache } from "./index.js";

/** 磁盘缓存预热所需的源视图（MarketIndexSource 结构性子集）。 */
export interface MarketWarmupSource {
	/** 竞速失效域:序号守卫防止过期回放 */
	readonly scope: RequestScope;
	/** 磁盘缓存 */
	readonly cache: MarketDiskCache;
	/** 索引扫描器(回放后读 total 供调试快照) */
	readonly scanner: ScannerLike;
	/** 进行中的预热任务(单飞去重) */
	warmDiskCacheTask: Promise<boolean> | undefined;
	/** 缓存元数据是否已就位(回放成功后置 true) */
	cacheMetaPresent: boolean;
	applyIndex(
		result: SearchResult,
		endpoint: string,
		contentHash?: string,
	): void;
	updateDebugInfo(
		info: MarketPerformanceSnapshot,
		phase?: "initial" | "refresh",
	): void;
	notifyRefresh(): unknown;
}

/** 磁盘缓存预热（单飞 + 过期序号守卫）。 */
export async function warmDiskCache(
	source: MarketWarmupSource,
	reason: string,
) {
	// 单飞:已在预热时直接复用,避免重复读盘与重复 applyIndex
	if (source.warmDiskCacheTask) return source.warmDiskCacheTask;
	const serial = source.scope.current;
	source.warmDiskCacheTask = applyDiskCache(source, serial)
		.then((loaded) => {
			if (loaded) {
				// 回放成功即通知前端刷新(此时用的可能是缓存数据)
				void source.notifyRefresh();
			}
			return loaded;
		})
		.finally(() => {
			source.warmDiskCacheTask = undefined;
		});
	void reason;
	return source.warmDiskCacheTask;
}

/** 应用磁盘缓存到内存索引；调用方需自行校验 serial 新鲜度。 */
export async function applyDiskCache(
	source: MarketWarmupSource,
	serial: number,
) {
	// 已有预热在跑:等它完成后,只要 serial 仍新鲜就算本次成功(复用结果)
	const warmTask = source.warmDiskCacheTask;
	if (warmTask) {
		const warmed = await warmTask;
		if (warmed && !source.scope.isStale(serial)) return true;
	}
	const { applied } = await source.cache.load();
	if (!applied) return false;
	// 回放前再校验一次:读盘期间若发起了新一轮请求,旧数据就不再上屏
	if (source.scope.isStale(serial)) return false;
	source.applyIndex(applied.result, applied.endpoint, applied.hash);
	source.cacheMetaPresent = true;
	source.updateDebugInfo(
		{
			source: "disk-cache",
			endpoint: applied.endpoint,
			objects: source.scanner.total,
			hash: shortHash(applied.hash),
			cachedAt: applied.fetchedAt,
			timings: {},
		},
		"initial",
	);
	return true;
}
