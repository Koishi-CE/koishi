/**
 * 市场数据类型定义：端点拉取结果、磁盘缓存条目/清单（v3 拆分布局）与路由统计持久化形状。
 *
 * 关键设计决策：
 * - `EndpointResult` 是 fetch-endpoint → fetch-index → collect/apply 链路的统一结果形状，
 *   同一份字段同时服务"应用索引"（result/hash/etag）与"性能调试"（timings/wireSize）两个目的。
 * - `CacheStore` 固定 version 3：索引体拆分到独立 JSON 文件，主清单只保留元数据引用，
 *   避免旧版（内联）单文件巨大 JSON 的读写放大；cache/normalize.ts 负责把历史形状归一到 v3。
 *
 * 架构位置：core/market 的最底层类型模块，被 source/*（拉取与聚合）、cache/*（磁盘持久化）、
 * snapshot.ts（性能快照）共同引用；自身不依赖 market 内其他模块。
 */

import type { Dict } from "@koishi-ce/koishi";
import type { SearchResult } from "@koishi-ce/registry";
import type { MarketPerformanceSnapshot } from "../../shared/types.js";

/**
 * 单次端点请求结果（fetch 链路的统一形状）。
 * network / http-304 / hash-cache 由 fetch-endpoint 产生，disk-cache / legacy 由缓存预热与聚合层补充。
 */
export interface EndpointResult {
	/** 胜出端点 URL */
	endpoint: string;
	/** 解析后的市场索引（@koishi-ce/registry SearchResult） */
	result: SearchResult;
	/** 该端点请求总耗时（ms） */
	elapsed: number;
	/** 本次竞速的候选端点总数 */
	candidates: number;
	/** 数据来源：network / http-304 / hash-cache / disk-cache / legacy */
	source: MarketPerformanceSnapshot["source"];
	/** 分阶段耗时（request/hash/parse/apply/total 等，ms） */
	timings: Dict<number>;
	/** 解压后正文大小（字节） */
	size?: number | undefined;
	/** 传输大小（字节，来自 content-length 或估算） */
	wireSize?: number | undefined;
	/** 响应压缩编码（br/gzip 等） */
	contentEncoding?: string | undefined;
	/** 正文 sha256（用于内容比对复用与 dataVersion 判定） */
	hash?: string | undefined;
	/** 响应 etag（下次条件请求用） */
	etag?: string | undefined;
	/** 响应 last-modified（下次条件请求用） */
	lastModified?: string | undefined;
	/** 用户配置的首选端点（与胜出端点可能不同，用于展示"降级到了谁"） */
	preferredEndpoint?: string | undefined;
	/** 非主端点胜出时的原因：主端点失败 / 主端点过慢 / 冷却端点救援 */
	fallbackReason?: "primary-failed" | "primary-slow" | "rescue" | undefined;
	/** 数据首次抓取时间戳（复用类结果沿用缓存链上的旧值） */
	cachedAt?: number | undefined;
	/** 数据最近一次校验（304/hash 比对）时间戳 */
	validatedAt?: number | undefined;
}

/** 磁盘缓存条目（v3 拆分布局：索引体在独立文件，条目只留元数据引用）。 */
export interface CacheEntry {
	/** 端点 URL（同时作为 entries 字典的键） */
	endpoint: string;
	/** 首次抓取时间戳（TTL 与新鲜度加分的计算基准） */
	fetchedAt: number;
	/** 最近一次 304/hash 校验时间戳 */
	validatedAt?: number | undefined;
	etag?: string | undefined;
	lastModified?: string | undefined;
	hash?: string | undefined;
	size?: number | undefined;
	wireSize?: number | undefined;
	contentEncoding?: string | undefined;
	/** 拆分布局下索引体所在文件名（相对 cacheDir）；内联布局则为空 */
	file?: string | undefined;
	/** 拆分布局写入清单时记录的索引对象数（仅统计用） */
	objects?: number | undefined;
	/** 内联索引体：仅内存态与 legacy 迁移前存在，v3 磁盘清单不含 */
	result?: SearchResult | undefined;
}

/** 内存中"条目元数据 + 已加载索引体"的完整形状（loadEntryResult 的返回）。 */
export type CacheFile = CacheEntry & { result: SearchResult };

/** 路由统计的持久化形状（与 cache 清单共储，重启后恢复端点学习状态）。 */
export interface PersistedRouteStats {
	/** 序列化时收敛到 [-6, 3] 的路由分数 */
	score: number;
	/** EWMA 平均延迟（ms） */
	averageElapsed?: number | undefined;
	/** 最近一次成功时间戳（恢复时判断是否乐观档） */
	lastSuccess?: number | undefined;
	contentEncoding?: string | undefined;
	/** 连续失败次数（冷却阶梯的输入） */
	consecutiveFailures?: number | undefined;
	/** 冷却截止时间戳 */
	cooldownUntil?: number | undefined;
}

/** 磁盘缓存主清单（v3）：元数据条目 + 路由统计共储。 */
export interface CacheStore {
	/** 布局版本，恒为 3（v2/legacy 由 normalize.ts 归一） */
	version: 3;
	/** 端点 → 缓存条目（拆分布局下通常只有元数据引用） */
	entries: Dict<CacheEntry>;
	/** 上次使用的端点（prune 时的保底优先项） */
	lastUsed?: string | undefined;
	/** 端点路由学习统计 */
	routeStats?: Dict<PersistedRouteStats> | undefined;
}

/** 缓存条目的元数据视图（去掉索引体；条件请求与展示用）。 */
export type CacheMeta = Omit<CacheFile, "result">;
