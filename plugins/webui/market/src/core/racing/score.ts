import { MINUTE } from "../utils/time.js";
import type { RouteStats } from "./stats.js";

export interface RouteScoreOptions {
    /** 是否主端点（+1 起始分） */
    isPrimary: boolean;
    /** 与 stats 记录一致的快速阈值（registry 800ms / 市场 500ms） */
    fastThreshold: number;
    /** 调用方附加分（市场：磁盘缓存新鲜度 + contentEncoding 加分） */
    extraScore?: number | undefined;
    now?: number | undefined;
}

/**
 * 路由评分：成功率、历史分、EWMA 延迟、近期成功、连续失败惩罚的加权。
 * 成块移植自旧 getRegistryRouteScore / getRouteScore（两者共用同一核心，差异走 extraScore）。
 */
export function routeScore(
    endpointStats: RouteStats | undefined,
    options: RouteScoreOptions,
): number {
    let score = options.isPrimary ? 1 : 0;
    score += options.extraScore ?? 0;
    if (!endpointStats) return score;

    score += getReliabilityScore(endpointStats);
    score += getHistoryScore(endpointStats);
    score += getLatencyScore(endpointStats.averageElapsed, options.fastThreshold);
    score += getRecentSuccessScore(endpointStats.lastSuccess, options.now);
    return score - Math.min(5, (endpointStats.consecutiveFailures ?? 0) * 1.5);
}

function getReliabilityScore(stats: RouteStats) {
    const total = stats.successes + stats.failures;
    if (!total) return 0;
    const successRate = stats.successes / total;
    let score = (successRate - 0.5) * 6;
    if (total >= 3 && successRate >= 0.8) score += 1.5;
    if (total >= 3 && successRate < 0.35) score -= 2;
    return score;
}

function getHistoryScore(stats: RouteStats) {
    return stats.score + Math.min(2, stats.successes * 0.25) - Math.min(2, stats.failures * 0.2);
}

function getLatencyScore(averageElapsed: number | undefined, fastThreshold: number) {
    if (averageElapsed == null) return 0;
    if (averageElapsed <= 300) return 1.5;
    if (averageElapsed <= fastThreshold) return 1;
    if (averageElapsed <= 1200) return 0.5;
    if (averageElapsed <= 2500) return -0.3;
    if (averageElapsed <= 4000) return -1;
    return -2;
}

function getRecentSuccessScore(lastSuccess: number | undefined, now = Date.now()) {
    return lastSuccess && now - lastSuccess <= 10 * MINUTE ? 1.5 : 0;
}

/** registry 的主端点慢速降级阈值（getFallbackDelay）：依据近期成功与失败次数收紧等待。 */
export function registryFallbackDelay(
    endpointStats: RouteStats | undefined,
    fastThreshold: number,
): number {
    if (!endpointStats) return fastThreshold;
    const recentSuccess =
        endpointStats.lastSuccess && Date.now() - endpointStats.lastSuccess <= 10 * MINUTE;
    if (!recentSuccess && endpointStats.failures >= 3) return 200;
    if (!recentSuccess && endpointStats.failures >= 2) return 400;
    if (endpointStats.averageElapsed != null) {
        if (endpointStats.averageElapsed > 4000) return 400;
        if (endpointStats.averageElapsed > 2500) return 600;
    }
    return fastThreshold;
}
