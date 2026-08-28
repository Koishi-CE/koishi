/**
 * @file 缓存读取与元数据恢复(core/market/cache 域)。
 *
 * 职责:readCacheStore 读主清单(ENOENT 视为空缓存,坏文件告警)并交给
 * normalize 归一;buildCacheMeta 在拉取成功后合并新响应与旧元数据
 * (304 场景沿用旧 etag/统计);restoreRouteStats 把持久化的路由统计
 * 恢复进内存,按"最近是否成功过"分档宽限,避免重启后端点被旧惩罚拖死。
 */
import { promises as fsp } from "node:fs";
import type { RouteStatsBook } from "../../racing/stats.js";
import { formatError } from "../../utils/format.js";
import { clamp } from "../../utils/math.js";
import { DAY } from "../../utils/time.js";
import type { CacheEntry, CacheMeta, CacheStore, EndpointResult } from "../types.js";
import { isLegacyInlineCacheStore, normalizeCacheStore } from "./normalize.js";

/** 读缓存所需依赖面(仅主清单路径与日志)。 */
interface CacheReadDeps {
    cacheFile: string;
    log: { debug(message: string): void; warn(message: string): void };
}

/**
 * 读取主缓存清单:读不到(ENOENT)返回 undefined 表示无缓存;
 * 读到则同时给出归一化后的 store 与"是否 legacy 内联布局需迁移"。
 * 注意 JSON.parse 抛错会向上传播,由调用方兜底。
 */
export async function readCacheStore(deps: CacheReadDeps) {
    let content: string;
    try {
        content = await fsp.readFile(deps.cacheFile, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
            deps.log.warn(`failed to read market disk cache: ${formatError(error)}`);
        } else {
            deps.log.debug("market disk cache is empty");
        }
        return;
    }
    const rawStore: unknown = JSON.parse(content);
    return {
        shouldMigrate: isLegacyInlineCacheStore(rawStore),
        store: normalizeCacheStore(rawStore),
    };
}

/**
 * 合并出新响应与历史缓存的元数据:响应没带 etag/last-modified(典型如
 * 304)且端点未变时沿用旧值,hash/size/wireSize/contentEncoding 同样
 * "新值优先、旧值兜底",保证条件请求与展示字段不因 304 而丢失。
 * 字段读取按"条件类/统计类"归口到下方两个小函数。
 */
export function buildCacheMeta(
    result: EndpointResult,
    cached: CacheEntry | undefined,
    previous: CacheMeta | undefined,
    sameEndpoint: boolean,
): CacheMeta {
    return {
        endpoint: result.endpoint,
        fetchedAt: getFetchedAt(result, cached, previous),
        validatedAt: result.validatedAt,
        etag: pickConditional(result.etag, previous?.etag, sameEndpoint),
        lastModified: pickConditional(result.lastModified, previous?.lastModified, sameEndpoint),
        hash: pickStat(result.hash, previous?.hash),
        size: pickStat(result.size, previous?.size),
        wireSize: pickStat(result.wireSize, previous?.wireSize),
        contentEncoding: pickStat(result.contentEncoding, previous?.contentEncoding),
    };
}

/**
 * 条件请求字段(etag/last-modified)的读取:新值优先,仅当端点未变时
 * 才兜底旧值 —— 换端点后不得沿用别的端点的条件元数据。
 */
function pickConditional<T>(
    fresh: T | undefined,
    previous: T | undefined,
    sameEndpoint: boolean,
): T | undefined {
    return fresh ?? (sameEndpoint ? previous : undefined);
}

/** 统计字段(hash/size 等)的读取:新值优先、旧值兜底,与端点无关。 */
function pickStat<T>(fresh: T | undefined, previous: T | undefined): T | undefined {
    return fresh ?? previous;
}

/**
 * 计算 fetchedAt:真正走了网络才刷新为当前时间;304/hash 复用类结果
 * 沿用链路上的旧时间戳(cachedAt → 条目 → 上一轮 meta)。
 */
function getFetchedAt(
    result: EndpointResult,
    cached: CacheEntry | undefined,
    previous: CacheMeta | undefined,
) {
    if (result.source === "network") return Date.now();
    return result.cachedAt ?? cached?.fetchedAt ?? previous?.fetchedAt ?? Date.now();
}

/**
 * 恢复持久化的路由统计到内存本:按 lastSuccess 是否在 1 天内分两档 ——
 * 近期成功过的按"乐观档"恢复(分数下限 -1、清零失败计数与冷却),
 * 否则按"保守档"(下限 -4 但保留连续失败与冷却),防止重启瞬间的
 * 端点选择被陈旧的失败记录过度惩罚;successes/failures 计数不持久化。
 */
export function restoreRouteStats(
    target: RouteStatsBook["stats"],
    routeStats: CacheStore["routeStats"],
) {
    if (!routeStats) return;
    for (const [endpoint, stats] of Object.entries(routeStats)) {
        if (!stats) continue;
        const hasRecentSuccess = stats.lastSuccess && Date.now() - stats.lastSuccess < DAY;
        target[endpoint] = {
            score: hasRecentSuccess ? clamp(stats.score, -1, 3) : clamp(stats.score, -4, 3),
            successes: 0,
            failures: 0,
            consecutiveFailures: hasRecentSuccess ? 0 : stats.consecutiveFailures,
            cooldownUntil: hasRecentSuccess ? undefined : stats.cooldownUntil,
            averageElapsed: stats.averageElapsed,
            lastSuccess: stats.lastSuccess,
            contentEncoding: stats.contentEncoding,
        };
    }
}

/** 从缓存条目提取元数据视图(去掉索引体,供条件请求与展示)。 */
export function getCacheMeta(entry: CacheEntry): CacheMeta {
    return {
        endpoint: entry.endpoint,
        fetchedAt: entry.fetchedAt,
        validatedAt: entry.validatedAt,
        etag: entry.etag,
        lastModified: entry.lastModified,
        hash: entry.hash,
        size: entry.size,
        wireSize: entry.wireSize,
        contentEncoding: entry.contentEncoding,
    };
}
