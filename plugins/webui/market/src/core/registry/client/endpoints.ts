/**
 * @file registry 端点候选与排序(core/registry/client 域)。
 *
 * 职责:维护 npm 镜像列表,提供探测候选排序(sortRouteProbeEndpoints,
 * 主端点 + 按评分排序的镜像)、元数据端点降级判定(preferredMetadataEndpoint)、
 * 调试评分表(registryRouteScores)与安装失败后的备用源推荐
 * (installFallbackCandidate)。纯函数,被 RegistryClient 消费。
 */
import type { InstallFallbackCandidate } from "../../../shared/types.js";
import type { RouteStatsBook } from "../../racing/stats.js";
import { formatEndpointHost } from "../../utils/format.js";

/** npm 镜像列表:主端点之外参与探测/竞速(autoRoute 关闭则不启用)。 */
const REGISTRY_FALLBACK_ENDPOINTS = [
    "https://registry.npmmirror.com",
    "https://mirrors.cloud.tencent.com/npm",
    "https://mirrors.huaweicloud.com/repository/npm",
    "https://registry.npmjs.org",
    "https://r.cnpmjs.org",
];

/** registry 客户端配置(端点/超时/autoRoute/重试)。 */
export interface RegistryClientConfig {
    endpoint?: string | undefined;
    timeout?: number | undefined;
    autoRoute?: boolean | undefined;
    retry?: number | undefined;
}

/** 端点评分函数签名(由 RegistryClient.getRouteScore 注入)。 */
export type RouteScoreFn = (endpoint: string) => number;

/** 去重后的候选端点：主端点 + （autoRoute 时的）镜像列表。 */
function registryEndpointCandidates(config: RegistryClientConfig, endpoint: string) {
    return [endpoint, ...(config.autoRoute === false ? [] : REGISTRY_FALLBACK_ENDPOINTS)].filter(
        (item, index, array): item is string => !!item && array.indexOf(item) === index,
    );
}

/** 探测候选：主端点 + 按评分排序的镜像（稳定排序保底原顺序）。 */
export function sortRouteProbeEndpoints(
    config: RegistryClientConfig,
    endpoint: string,
    score: RouteScoreFn,
) {
    const endpoints = registryEndpointCandidates(config, endpoint);
    if (config.autoRoute === false) return endpoints;
    const primary = endpoints[0];
    if (!primary) return endpoints;
    const fallbacks = endpoints.slice(1);
    // 原始顺序做 tie-breaker:评分并列时保持镜像列表既定优先级
    const originalIndex = new Map(fallbacks.map((item, index) => [item, index]));
    return [
        primary,
        ...fallbacks.sort((a, b) => {
            const delta = score(b) - score(a);
            if (delta) return delta;
            return (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0);
        }),
    ];
}

/** 当前元数据端点降级判定：所选端点连续失败且分数显著低于主端点时回退主端点。 */
export function preferredMetadataEndpoint(options: {
    endpoint: string;
    metadataEndpoint: string;
    stats: RouteStatsBook;
    score: RouteScoreFn;
    log: { debug(message: string): void };
}) {
    const { endpoint, metadataEndpoint, stats, score, log } = options;
    const selected = metadataEndpoint || endpoint;
    // 本来就是主端点:无从降级
    if (selected === endpoint) return selected;
    const selectedStats = stats.get(selected);
    if (!selectedStats) return selected;
    const primaryScore = score(endpoint);
    const selectedScore = score(selected);
    // 连续失败 ≥2 且评分比主端点低超过 1 分:镜像劣化明显,回退主端点
    if (selectedStats.failures >= 2 && selectedScore + 1 < primaryScore) {
        log.debug(
            `demote npm metadata endpoint: selected=${selected}, selectedScore=${selectedScore.toFixed(1)}, primary=${endpoint}, primaryScore=${primaryScore.toFixed(1)}, failures=${selectedStats.failures}, lastFailure=${selectedStats.lastFailureReason ?? "-"}`,
        );
        return endpoint;
    }
    return selected;
}

/** 调试用路由评分表。 */
export function registryRouteScores(options: {
    config: RegistryClientConfig;
    endpoint: string;
    stats: RouteStatsBook;
    score: RouteScoreFn;
    fallbackDelay: (endpoint: string) => number | undefined;
}) {
    return registryEndpointCandidates(options.config, options.endpoint).map((item) => ({
        endpoint: item,
        score: options.score(item),
        // 只对主端点给出错峰延迟(其余端点的延迟由竞速器内部计算)
        fallbackDelay: item === options.endpoint ? options.fallbackDelay(item) : undefined,
        ...options.stats.get(item),
    }));
}

/** 安装备用源推荐：排除失败端点与用户配置端点后按评分取最优。 */
export function installFallbackCandidate(options: {
    config: RegistryClientConfig;
    endpoint: string;
    stats: RouteStatsBook;
    score: RouteScoreFn;
}): InstallFallbackCandidate | undefined {
    const { config, endpoint, stats, score } = options;
    if (config.autoRoute === false) return undefined;
    // 尾斜杠归一后再比较:同一镜像可能以带/不带斜杠两种形态出现
    const normalize = (item?: string) => item?.replace(/\/+$/, "");
    const failed = normalize(endpoint);
    const candidates = registryEndpointCandidates(config, endpoint)
        .filter((item) => normalize(item) !== failed)
        .filter((item) => normalize(item) !== normalize(config.endpoint))
        .map((item, index) => ({
            endpoint: item,
            index,
            score: score(item),
            stats: stats.get(item),
        }))
        .sort((a, b) => {
            const delta = b.score - a.score;
            if (delta) return delta;
            // 评分并列:最近成功过的优先,再按镜像列表原始顺序
            const successDelta = (b.stats?.lastSuccess ?? 0) - (a.stats?.lastSuccess ?? 0);
            if (successDelta) return successDelta;
            return a.index - b.index;
        });
    const candidate = candidates[0];
    if (!candidate) return undefined;
    return {
        endpoint: candidate.endpoint,
        label: formatEndpointHost(candidate.endpoint),
        reason: candidate.stats?.lastSuccess ? "最近可用的备用 npm 源" : "备用 npm 源",
    };
}

/**
 * 重试轮次的端点顺序:首选端点(当前元数据端点降级判定后)+
 * 按评分排序的探测候选,去重保序。成块移植自 RegistryClient.retryEndpoints。
 */
export function registryRetryEndpoints(options: {
    config: RegistryClientConfig;
    endpoint: string;
    metadataEndpoint: string;
    stats: RouteStatsBook;
    score: RouteScoreFn;
    log: { debug(message: string): void };
}) {
    return [
        preferredMetadataEndpoint({
            endpoint: options.endpoint,
            metadataEndpoint: options.metadataEndpoint,
            stats: options.stats,
            score: options.score,
            log: options.log,
        }),
        ...sortRouteProbeEndpoints(options.config, options.endpoint, options.score),
    ].filter(
        (endpoint, index, array): endpoint is string =>
            !!endpoint && array.indexOf(endpoint) === index,
    );
}
