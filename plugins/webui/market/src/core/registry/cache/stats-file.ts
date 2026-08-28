/**
 * @file registry 路由统计的持久化形状与序列化(core/registry/cache 域)。
 *
 * 职责:serializeRegistryStats 把内存 RouteStatsBook 压成可落盘视图
 * (分数收敛到 [-6, 3]);restoreRegistryStats 从磁盘恢复学习数据,
 * 30 天 TTL,且按"最近一天是否成功过"分档宽限(失败数收敛、连续失败
 * 清零),避免重启后端点被陈旧失败记录拖进长冷却。
 */
import type { Dict } from "@koishi-ce/koishi";
import type { RouteStats, RouteStatsBook } from "../../racing/stats.js";
import { clamp } from "../../utils/math.js";
import { DAY } from "../../utils/time.js";
import type { RegistryReason } from "../errors.js";

/** 路由统计的持久化条目(比内存态少了运行时字段)。 */
export interface PersistedRegistryStats {
    /** 收敛到 [-6, 3] 的路由分数 */
    score: number;
    successes?: number | undefined;
    failures?: number | undefined;
    consecutiveFailures?: number | undefined;
    /** EWMA 平均延迟(ms) */
    averageElapsed?: number | undefined;
    lastSuccess?: number | undefined;
    lastFailure?: number | undefined;
    lastFailureReason?: RegistryReason | undefined;
    contentEncoding?: string | undefined;
}

/** 路由统计文件结构(version 1)。 */
export interface RegistryStatsStore {
    version: 1;
    stats: Dict<PersistedRegistryStats>;
    savedAt: number;
}

/** 写盘视图：分数收敛到 [-6, 3]。 */
export function serializeRegistryStats(book: RouteStatsBook): Dict<PersistedRegistryStats> {
    const stats: Dict<PersistedRegistryStats> = {};
    for (const [endpoint, value] of Object.entries(book.stats)) {
        if (!value) continue;
        stats[endpoint] = {
            score: clamp(value.score, -6, 3),
            successes: value.successes,
            failures: value.failures,
            consecutiveFailures: value.consecutiveFailures,
            averageElapsed: value.averageElapsed,
            lastSuccess: value.lastSuccess,
            lastFailure: value.lastFailure,
            lastFailureReason: value.lastFailureReason as RegistryReason | undefined,
        };
    }
    return stats;
}

/**
 * 从磁盘恢复学习数据：30 天 TTL；近期有成功的端点失败数收敛、连续失败清零。
 * 成块移植自旧 Installer.loadRouteStats。
 */
export function restoreRegistryStats(
    book: RouteStatsBook,
    store: RegistryStatsStore | undefined,
    log?: (message: string) => void,
) {
    if (!store?.stats || store.version !== 1) return;
    // 超过 30 天的学习数据视为过时,全部丢弃
    if (Date.now() - store.savedAt > 30 * DAY) return;
    for (const [endpoint, stats] of Object.entries(store.stats)) {
        if (!stats) continue;
        book.stats[endpoint] = restoreRegistryStat(stats);
    }
    log?.(`npm registry route stats restored from disk: ${Object.keys(store.stats).join(", ")}`);
}

/**
 * 恢复单条统计:近 1 天成功过的端点按"乐观档"(分数下限 -1、失败数
 * 收敛到成功数一半、连续失败清零),否则按"保守档"(下限 -4、失败数
 * 上限 12、保留连续失败),在"不至于重蹈覆辙"与"不冤枉端点"间取衡。
 */
function restoreRegistryStat(stats: PersistedRegistryStats): RouteStats {
    const successes = Math.max(0, Number(stats.successes) || 0);
    const failures = Math.max(0, Number(stats.failures) || 0);
    const hasRecentSuccess =
        Number(stats.lastSuccess) && Date.now() - Number(stats.lastSuccess) < DAY;
    return {
        score: hasRecentSuccess ? clamp(stats.score, -1, 3) : clamp(stats.score, -4, 3),
        successes,
        failures: hasRecentSuccess
            ? Math.min(failures, Math.max(2, Math.ceil(successes / 2)))
            : Math.min(failures, 12),
        consecutiveFailures: hasRecentSuccess
            ? 0
            : Math.max(0, Number(stats.consecutiveFailures) || 0),
        averageElapsed: stats.averageElapsed,
        lastSuccess: stats.lastSuccess,
        lastFailure: stats.lastFailure,
        lastFailureReason: stats.lastFailureReason,
    };
}
