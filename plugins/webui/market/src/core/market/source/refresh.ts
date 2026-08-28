/**
 * @file 刷新入口与预备任务刷新登记(core/market/source 域)。
 *
 * 职责:startMarketIndex 是手动/自动刷新入口(旧 start 主流程):复用仍在
 * 跑的同 serial 后台任务、手动刷新清空端点冷却、已有数据/缓存回放成功时
 * 先上屏并交给后台刷新,否则走完整 collect;scheduleRefreshAfterPrepareTask
 * 登记"完成后需要触发刷新"的任务(去重)并在结束后通知前端。
 *
 * 架构位置:从 source/index.ts 同名方法成块搬移,经 MarketRefreshSource/
 * MarketPendingRefreshSource 结构性子集与 MarketIndexSource 解耦。
 */
import type { SearchResult } from "@koishi-ce/registry";
import type { RouteStatsBook } from "../../racing/stats.js";
import { applyDiskCache } from "../cache/warmup.js";
import { flushMarketPatch, type MarketCollectSource } from "./collect.js";
import { clearRouteCooldowns } from "./endpoints.js";
import type { MarketSourceDeps } from "./types.js";

/** start 刷新入口所需的源视图（MarketIndexSource 结构性子集）。 */
export interface MarketRefreshSource extends MarketCollectSource {
	readonly stats: RouteStatsBook;
	/** 进行中的后台任务与其序号(复用判定,background.ts 共用) */
	backgroundTask: Promise<void> | undefined;
	backgroundSerial: number | undefined;
	/** 进行中的 collect 任务(start 触发) */
	collectTask: Promise<SearchResult | undefined> | undefined;
	collectError: unknown;
	hasCurrentData(): boolean;
	collect(): Promise<undefined>;
}

/** 手动/自动刷新入口（旧 start 主流程）。 */
export async function startMarketIndex(
	source: MarketRefreshSource,
	refresh: boolean,
) {
	// 同 serial 的后台任务仍在跑:直接复用它的序号,不重复推进/拉取
	const reuseBackground =
		refresh &&
		!!source.backgroundTask &&
		source.backgroundSerial === source.scope.current;
	const serial = reuseBackground
		? source.scope.current
		: source.scope.current + 1;
	if (!reuseBackground) source.scope.advance("market refresh superseded");
	source.forceRefresh = false;
	if (refresh) {
		// 手动刷新清空所有端点冷却,给每个镜像公平的重新竞争机会
		clearRouteCooldowns(source.stats);
		if (source.hasCurrentData() || (await applyDiskCache(source, serial))) {
			if (!source.scope.isStale(serial)) {
				// 已有数据或缓存回放成功:先上屏,刷新交给后台
				if (!source.hasCurrentData())
					source.background.refreshInBackground(serial, "soft refresh");
				void source.deps.notifyRefresh();
			}
			return;
		}
		source.collectTask = undefined;
		source.collectError = undefined;
	}
	source.collectTask = source.collect();
	await source.collectTask;
	// legacy 分析产生的补片在 collect 结束后统一广播一次
	flushMarketPatch(source);
	if (!source.scope.isStale(serial)) {
		void source.deps.notifyRefresh();
	}
}

/** 预备任务刷新登记所需的源视图（MarketIndexSource 结构性子集）。 */
export interface MarketPendingRefreshSource {
	/** 已登记的"完成后触发刷新"任务(去重判定) */
	pendingRefreshTask: Promise<unknown> | undefined;
	readonly deps: Pick<MarketSourceDeps, "notifyRefresh">;
}

/**
 * 登记一个"完成后需要触发刷新"的任务(去重:同一任务只登记一次),
 * 结束后通知前端刷新。
 */
export function scheduleRefreshAfterPrepareTask(
	source: MarketPendingRefreshSource,
	task: Promise<unknown>,
) {
	if (source.pendingRefreshTask === task) return;
	source.pendingRefreshTask = task;
	void task.finally(() => {
		if (source.pendingRefreshTask === task)
			source.pendingRefreshTask = undefined;
		void source.deps.notifyRefresh();
	});
}
