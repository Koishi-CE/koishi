/**
 * @file 市场端点候选与评分(core/market/source 域)。
 *
 * 职责:维护主端点 + 社区镜像列表,给出候选列表(getEndpointCandidates)、
 * 竞速名单(getRaceEndpoints:主端点 + 未冷却镜像按评分排序)、救援名单
 * (getRescueEndpoints:被冷却的端点)与冷却清理(clearRouteCooldowns)。
 * marketRouteScore 在共享评分核心(racing/score)之上叠加市场特有加分:
 * 磁盘缓存新鲜度与压缩编码(br/gzip 传输更快)。
 */
import { routeScore } from "../../racing/score.js";
import type { RouteStatsBook } from "../../racing/stats.js";
import { DAY } from "../../utils/time.js";

/** 默认主端点(配置缺省时的回退)。 */
export const DEFAULT_ENDPOINT = "https://registry.koishi.t4wefan.pub/index.json";
/** 社区镜像列表:主端点之外按序参与竞速(autoRoute 关闭则不启用)。 */
const FALLBACK_ENDPOINTS = [
    "https://registry.koishi.t4wefan.pub/index.json",
    "https://gitee.com/shangxueink/koishi-registry-aggregator/raw/gh-pages/market.json",
    "https://koi.nyan.zone/registry/index.json",
    "https://kp.itzdrli.cc",
    "https://koishi.itzdrli.cc",
    "https://registry.koishi.chat/index.json",
    "https://koishijs.github.io/registry/index.json",
    "https://raw.githubusercontent.com/koishijs/registry/release/index.json",
    "https://cdn.jsdelivr.net/gh/koishijs/registry@release/index.json",
    "https://ghproxy.net/https://raw.githubusercontent.com/koishijs/registry/release/index.json",
    "https://ghfast.top/https://raw.githubusercontent.com/koishijs/registry/release/index.json",
];

/** 端点相关配置(endpoint:首选端点;autoRoute:false 关闭镜像竞速)。 */
export interface MarketEndpointConfig {
    endpoint?: string | undefined;
    autoRoute?: boolean | undefined;
}

/** 市场路由评分上下文:配置 + 学习统计 + 缓存条目(新鲜度加分用)。 */
export interface MarketScoreContext {
    config: MarketEndpointConfig;
    stats: RouteStatsBook;
    /** 磁盘缓存条目（新鲜度加分）；无则传空对象 */
    cacheEntries: { [endpoint: string]: { fetchedAt: number } | undefined };
    now?: number;
}

/** 市场端点评分：共享评分核心 + 缓存新鲜度与压缩编码加分。 */
export function marketRouteScore(endpoint: string, context: MarketScoreContext) {
    const stats = context.stats.get(endpoint);
    const cached = context.cacheEntries[endpoint];
    let extraScore = 0;
    if (cached) {
        // 有磁盘缓存的端点即使慢也能靠 304/hash 复用快速返回,适度加分
        const age = (context.now ?? Date.now()) - cached.fetchedAt;
        extraScore += age <= DAY ? 1.5 : 0.5;
    }
    // 压缩编码显著降低传输量:br 优于 gzip
    if (stats?.contentEncoding === "br") extraScore += 0.5;
    if (stats?.contentEncoding === "gzip") extraScore += 0.2;
    return routeScore(stats, {
        isPrimary: endpoint === context.config.endpoint,
        fastThreshold: 500,
        extraScore,
        now: context.now,
    });
}

/** 候选端点列表:配置主端点在前 + (autoRoute 未关时)镜像,去重去空。 */
export function getEndpointCandidates(config: MarketEndpointConfig) {
    return [config.endpoint, ...(config.autoRoute === false ? [] : FALLBACK_ENDPOINTS)].filter(
        (endpoint, index, array): endpoint is string =>
            !!endpoint && array.indexOf(endpoint) === index,
    );
}

/** 端点是否处于失败冷却期(主端点永不冷却,始终参与)。 */
function isRouteCoolingDown(
    endpoint: string,
    config: MarketEndpointConfig,
    stats: RouteStatsBook,
    now?: number,
) {
    if (endpoint === config.endpoint) return false;
    const until = stats.get(endpoint)?.cooldownUntil;
    return !!until && (now ?? Date.now()) < until;
}

/** 清空全部端点的冷却与连续失败计数(手动刷新时给所有端点重新竞争机会)。 */
export function clearRouteCooldowns(stats: RouteStatsBook) {
    for (const item of Object.values(stats.stats)) {
        if (!item) continue;
        item.cooldownUntil = undefined;
        item.consecutiveFailures = 0;
    }
}

/** 竞速候选：主端点 + 未冷却镜像按评分排序（稳定排序保底原顺序）。 */
export function getRaceEndpoints(
    context: MarketScoreContext & { log?: { debug(message: string): void } },
) {
    const candidates = getEndpointCandidates(context.config);
    // autoRoute 关闭:只用配置端点,不做任何镜像竞速
    if (context.config.autoRoute === false) return candidates;
    const primary = candidates[0];
    if (!primary) return candidates;
    const fallbacks = candidates.slice(1);
    const available = fallbacks.filter(
        (endpoint) => !isRouteCoolingDown(endpoint, context.config, context.stats),
    );
    // 原始顺序做 tie-breaker:评分并列时保持镜像列表的既定优先级
    const originalIndex = new Map(fallbacks.map((endpoint, index) => [endpoint, index]));
    return [
        primary,
        ...available.sort((a, b) => {
            const delta = marketRouteScore(b, context) - marketRouteScore(a, context);
            if (delta) return delta;
            return (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0);
        }),
    ];
}

/** 全部活跃端点失败后的救援候选：被冷却的端点。 */
export function getRescueEndpoints(activeEndpoints: string[], context: MarketScoreContext) {
    if (context.config.autoRoute === false) return [];
    const active = new Set(activeEndpoints);
    return getEndpointCandidates(context.config).filter((endpoint) => !active.has(endpoint));
}
