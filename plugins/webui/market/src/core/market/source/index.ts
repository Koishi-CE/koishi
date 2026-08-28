/**
 * @file 市场索引源主体(core/market/source 域)。
 *
 * MarketIndexSource 是市场数据的持有者与编排中枢:组合磁盘缓存
 * (MarketDiskCache)、索引扫描器(scanner)、竞速失效域(scope)与后台
 * 刷新器(MarketBackgroundRefresher);对外提供 start(刷新入口)、
 * collect(首拉/缓存优先)、applyIndex(应用索引)、getSnapshot(快照视图)。
 *
 * 关键设计:大量字段是"跨文件共享状态",本类只声明与维护,编排主体分布在
 * apply.ts(应用/竞速拉取落盘)、refresh.ts(start 主流程)、background.ts
 * (后台刷新/探测)、collect.ts(collect 主流程)、host.ts(性能/快照视图)，
 * 通过结构性子集接口解耦;dataVersion 只在内容 hash 变化时递增,revision
 * 每次 apply 都递增;start(refresh) 复用仍在跑的同 serial 后台任务。
 */

import type { Dict } from "@koishi-ce/koishi";
import type { SearchObject, SearchResult } from "@koishi-ce/registry";
import type {
	MarketPerformance,
	MarketPerformanceSnapshot,
} from "../../../shared/types.js";
import { RequestScope } from "../../racing/request-scope.js";
import { createScanner, type ScannerLike } from "../../registry/manifest.js";
import { MarketDiskCache } from "../cache/index.js";
import { warmDiskCache as warmDiskCacheTask } from "../cache/warmup.js";
import { buildMarketSnapshot, type MarketSnapshotInput } from "../snapshot.js";
import {
	applyMarketIndex,
	fetchAndApplyMarketIndex,
	type MarketVersionCounters,
} from "./apply.js";
import {
	MarketBackgroundRefresher,
	type MarketBackgroundSource,
} from "./background.js";
import { collectMarketIndex, type MarketCollectSource } from "./collect.js";
import { getEndpointCandidates, type MarketScoreContext } from "./endpoints.js";
import {
	createSourceSnapshotHost,
	exportMarketPerformance,
	mergeMarketPerformance,
} from "./host.js";
import {
	scheduleRefreshAfterPrepareTask,
	startMarketIndex,
} from "./refresh.js";
import {
	createMarketRouteStatsBook,
	type MarketSourceConfig,
	type MarketSourceDeps,
} from "./types.js";

export type { MarketSourceConfig, MarketSourceDeps };

/**
 * 市场索引源：竞速拉取 + 磁盘缓存 + 后台刷新编排。
 * 成块移植自旧 node/MarketProvider（剥离 DataService 壳后的主体）。
 */
export class MarketIndexSource
	implements MarketBackgroundSource, MarketCollectSource
{
	/** 竞速失效域:刷新/安装等事件推进序号使旧请求作废 */
	readonly scope = new RequestScope();
	/** 端点路由学习统计(与磁盘缓存共储) */
	readonly stats = createMarketRouteStatsBook();
	readonly cache: MarketDiskCache;
	readonly scanner: ScannerLike;
	readonly background: MarketBackgroundRefresher;
	/** 当前生效端点(胜出端点,可能与配置首选不同) */
	endpoint = "";

	/** 跨文件状态：background.ts 编排、source-host.ts 快照视图共用。 */
	backgroundTask: Promise<void> | undefined;
	backgroundSerial: number | undefined;
	collectError: unknown;
	warmDiskCacheTask: Promise<boolean> | undefined;
	/** 缓存预热/后台刷新产出的快照载荷(供 getSnapshot 直接返回) */
	payloadValue: MarketSnapshotInput | undefined;
	/** 磁盘缓存元数据是否已回放(cache-first 场景的 meta 来源) */
	cacheMetaPresent = false;
	/** 跨文件状态：collect.ts 的 collect 编排与补片广播共用。 */
	/** legacy 分析失败的包名列表 */
	failed: string[] = [];
	/** legacy 分析完成的全量对象缓存(包名 → SearchObject) */
	fullCache: Dict<SearchObject> = {};
	/** 待广播的分析补片(分析过程中增量累积,flush 后清空) */
	tempCache: Dict<SearchObject> = {};
	/** 性能调试信息(market debug 卡数据) */
	debugInfoValue: MarketPerformance | undefined;
	/** true 时 collect 跳过磁盘缓存直接走网络 */
	forceRefresh = false;
	/** 跨文件状态：版本计数(apply.ts 更新,getter 侧只读暴露)。 */
	readonly counters: MarketVersionCounters = {
		dataVersion: 0,
		revision: 0,
		contentHash: undefined,
	};
	/** 跨文件状态：refresh.ts 的预备任务刷新登记。 */
	pendingRefreshTask: Promise<unknown> | undefined;
	/** 进行中的 collect 任务(单飞,refresh.ts 的 start 编排共用) */
	collectTask: Promise<SearchResult | undefined> | undefined;
	readonly deps: MarketSourceDeps;
	readonly config: MarketSourceConfig;

	constructor(deps: MarketSourceDeps, config: MarketSourceConfig = {}) {
		this.deps = deps;
		this.config = config;
		this.config.endpoint ||= "https://registry.koishi.t4wefan.pub/index.json";
		this.endpoint = this.config.endpoint;
		this.scanner = createScanner(deps.scannerRequest);
		this.cache = new MarketDiskCache({
			cacheFile: deps.cacheFile,
			cacheDir: deps.cacheDir,
			stats: this.stats,
			scoreContext: () => this.scoreContext(),
			endpointCandidates: () => getEndpointCandidates(this.config),
			log: deps.log,
			// scope 已 dispose 视为宿主停用,缓存不再落盘
			isAlive: () => !this.scope.isDisposed,
		});
		this.background = new MarketBackgroundRefresher(this);
	}

	/** 组装路由评分上下文(配置 + 路由统计 + 缓存条目)。 */
	scoreContext(): MarketScoreContext {
		return {
			config: this.config,
			stats: this.stats,
			cacheEntries: this.cache.entries,
		};
	}

	/** 是否已有可用数据(任一来源:快照载荷/scanner/fullCache)。 */
	hasCurrentData() {
		return (
			!!this.payloadValue ||
			!!this.scanner.version ||
			this.scanner.total > 0 ||
			Object.keys(this.fullCache).length > 0
		);
	}

	get log() {
		return this.deps.log;
	}

	notifyRefresh() {
		return this.deps.notifyRefresh();
	}

	/** 重置探测/刷新前的一次性状态（background.ts 调用）。 */
	resetProbeState() {
		this.failed = [];
		this.fullCache = {};
		this.tempCache = {};
		this.debugInfoValue = undefined;
		this.collectTask = undefined;
		this.collectError = undefined;
	}

	/** 预热磁盘缓存(透传 cache/warmup.ts,单飞 + 序号守卫)。 */
	async warmDiskCache(reason: string) {
		return warmDiskCacheTask(this, reason);
	}

	/** 应用一份索引到内存（主体在 apply.ts）。 */
	applyIndex(result: SearchResult, endpoint: string, contentHash?: string) {
		applyMarketIndex(this, result, endpoint, contentHash);
	}

	/** 竞速拉取并落盘（collect 的网络部分，主体在 apply.ts）。 */
	async fetchAndApply(serial: number, phase: "initial" | "refresh") {
		return fetchAndApplyMarketIndex(this, serial, phase);
	}

	/** 旧版 collect：磁盘缓存优先，否则网络（主体在 collect.ts）。 */
	async collect(): Promise<undefined> {
		return collectMarketIndex(this);
	}

	/** 手动/自动刷新入口（旧 start 主流程，主体在 refresh.ts）。 */
	async start(refresh: boolean) {
		return startMarketIndex(this, refresh);
	}

	/** 构建当前状态快照(经 host.ts 适配后交给 shared 的快照组装)。 */
	getSnapshot() {
		return buildMarketSnapshot(createSourceSnapshotHost(this));
	}

	/** 惰性启动 collect(单飞):失败记录到 collectError 并允许重试。 */
	prepareTask(): Promise<SearchResult | undefined> {
		this.collectTask ??= this.collect().catch((error: unknown) => {
			this.collectError = error;
			this.collectTask = undefined;
			return undefined;
		});
		return this.collectTask;
	}

	get error() {
		return this.collectError;
	}

	get dataVersionValue() {
		return this.counters.dataVersion;
	}

	get revisionValue() {
		return this.counters.revision;
	}

	/** 递增并返回修订号(补片广播时使用)。 */
	nextRevision() {
		return ++this.counters.revision;
	}

	/** 合并更新性能调试信息（计算主体在 host.ts）。 */
	updateDebugInfo(
		info: MarketPerformanceSnapshot,
		phase?: "initial" | "refresh",
	) {
		this.debugInfoValue = mergeMarketPerformance(
			this.debugInfoValue,
			info,
			phase,
		);
	}

	/** logLevel=debug 时才对外暴露 debug 信息（计算主体在 host.ts）。 */
	exportedDebug(timings?: Dict<number>): MarketPerformance | undefined {
		return exportMarketPerformance(
			this.config.logLevel,
			this.debugInfoValue,
			timings,
		);
	}

	failedCount() {
		return this.failed.length;
	}

	/** 登记预备任务刷新(主体在 refresh.ts)。 */
	scheduleRefreshAfterPrepare(task: Promise<unknown>) {
		scheduleRefreshAfterPrepareTask(this, task);
	}

	/** 空闲探测入口(透传 background.ts)。 */
	probeInBackground(reason = "idle probe") {
		return this.background.probeInBackground(reason);
	}
}
