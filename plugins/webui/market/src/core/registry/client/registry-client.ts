/**
 * @file npm registry 元数据客户端本体(core/registry/client 域)。
 *
 * RegistryClient 是 registry 域的门面:组合路由探测(probe)、多端点竞速
 * 拉取(route-fetch)、带重试的获取主循环(fetch)与端点评分(endpoints);
 * 路由学习状态经 RouteStateTracker(route-state.ts)管理,重启后从
 * statsFile 恢复;构造注入面见 deps.ts 的 RegistryClientDeps。
 *
 * 关键设计:
 * - endpoint(主端点,配置/默认值)与 metadataEndpoint(探测胜出的实际
 *   端点)分离,resetEndpoint 时统一复位并重置路由统计;
 * - 状态变化经 statusSink 上报,携带 serial 供前端过滤过期状态。
 *
 * 架构位置:被 deps/resolver(元数据刷新)、registry/cache(包缓存)、
 * node 适配层(端点状态展示)消费;HTTP 通道经 httpFactory 注入。
 */
import type { RegistryStatsStore } from "../cache/stats-file.js";
import { formatRegistryError, type RegistryErrorDetail, type RegistryReason } from "../errors.js";
import type { Registry } from "../manifest.js";
import type { RegistryClientDeps } from "./deps.js";
import {
    installFallbackCandidate,
    type RegistryClientConfig,
    registryRetryEndpoints,
    registryRouteScores,
    sortRouteProbeEndpoints,
} from "./endpoints.js";
import { fetchRegistryWithRetry, type RegistryFetchHost } from "./fetch.js";
import { RouteProbe } from "./probe.js";
import { fetchRegistryByRoute, type RegistryRouteDeps } from "./route-fetch.js";
import { RouteStateTracker } from "./route-state.js";

/**
 * npm registry 元数据客户端：多端点竞速 + 学习型路由 + 重试。
 * 成块移植自旧 Installer 的路由相关方法，算法未改。
 */
export class RegistryClient implements RegistryFetchHost {
    /** 主端点(配置值或默认值,resetEndpoint 时确定) */
    endpoint = "";
    /** 元数据实际端点(探测胜出后可能切换到的镜像) */
    metadataEndpoint = "";
    private readonly deps: RegistryClientDeps;
    private readonly probe: RouteProbe;
    private readonly routeDeps: RegistryRouteDeps;
    private readonly routeState: RouteStateTracker;
    public config: RegistryClientConfig;

    constructor(deps: RegistryClientDeps, config: RegistryClientConfig = {}) {
        this.deps = deps;
        this.config = config;
        this.routeState = new RouteStateTracker({
            stats: deps.stats,
            statsFile: deps.statsFile,
            log: deps.log,
        });
        this.probe = new RouteProbe({
            scope: deps.scope,
            log: deps.log,
            scoresSummary: () => JSON.stringify(this.getRouteScores().map((item) => item.endpoint)),
        });
        // 把宿主方法适配为 route-fetch 所需的最小依赖面
        this.routeDeps = {
            httpFactory: deps.httpFactory,
            scope: deps.scope,
            log: deps.log,
            getFallbackDelay: (endpoint) => this.getFallbackDelay(endpoint),
            formatError: (error) => this.formatError(error),
            recordRouteSuccess: (result) => this.recordRouteSuccess(result),
            recordRouteFailure: (endpoint, reason) => this.recordRouteFailure(endpoint, reason),
        };
    }

    get scope() {
        return this.deps.scope;
    }

    /** 异常归因:接 registry/errors 的 formatRegistryError,产出 reason/error。 */
    formatError(error: unknown): RegistryErrorDetail {
        return formatRegistryError(error, this.deps.isHttpError);
    }

    /**
     * 重置端点:按配置(或默认值)恢复主端点与元数据端点,清空探测状态;
     * 端点真的变了才重置路由统计 —— 学习数据按端点集合有效性作废。
     */
    async resetEndpoint() {
        const endpoint = this.config.endpoint || (await this.deps.defaultEndpoint());
        const previous = this.endpoint;
        this.endpoint = endpoint;
        this.metadataEndpoint = endpoint;
        this.probe.reset();
        if (previous && previous !== endpoint) {
            this.routeState.reset();
            this.deps.log.info(
                `npm registry endpoint changed: previous=${previous}, current=${endpoint}, routeStats=reset`,
            );
        }
    }

    /** 从持久化文件恢复路由学习统计(启动时调用)。 */
    async restoreStats(store: RegistryStatsStore | undefined) {
        this.routeState.restore(store);
    }

    /** 防抖写路由统计到 statsFile(每次成功/失败记录后调用)。 */
    scheduleStatsWrite() {
        this.routeState.scheduleWrite();
    }

    /** 单端点评分:共享评分核心,主端点加分,快阈值 800ms。 */
    getRouteScore(endpoint: string) {
        return this.routeState.score(endpoint, endpoint === this.endpoint);
    }

    /** 端点的竞速错峰延迟(慢端点延迟启动,给快端点先手机会)。 */
    getFallbackDelay(endpoint: string) {
        return this.routeState.fallbackDelay(endpoint);
    }

    /** 安装失败后的备用源推荐(排除失败端点与用户配置端点)。 */
    getInstallFallbackCandidate(failedEndpoint?: string) {
        return installFallbackCandidate({
            config: this.config,
            endpoint: failedEndpoint || this.endpoint,
            stats: this.routeState.stats,
            score: (item) => this.getRouteScore(item),
        });
    }

    /** 调试用路由评分表(端点/评分/统计明细)。 */
    getRouteScores() {
        return registryRouteScores({
            config: this.config,
            endpoint: this.endpoint,
            stats: this.routeState.stats,
            score: (item) => this.getRouteScore(item),
            fallbackDelay: (item) =>
                item === this.endpoint ? this.getFallbackDelay(item) : undefined,
        });
    }

    private recordRouteSuccess(result: { endpoint: string; elapsed: number }) {
        this.routeState.recordSuccess(result);
    }

    private recordRouteFailure(endpoint: string, reason?: RegistryReason) {
        this.routeState.recordFailure(endpoint, reason);
    }

    /**
     * 确保元数据路由已探测:候选端点按评分排序后交给 RouteProbe,
     * 一个探针包竞速选出后续默认走的 metadataEndpoint(单飞,一次生命周期一次)。
     */
    async ensureMetadataEndpoint(name: string, serial: number) {
        const endpoints = sortRouteProbeEndpoints(this.config, this.endpoint, (item) =>
            this.getRouteScore(item),
        );
        await this.probe.ensure(name, endpoints, serial, (n, e, s) => this.fetchByRoute(n, e, s));
    }

    /** 获取单个包的 registry 元数据(fetch.ts 的带重试主循环)。 */
    async getRegistry(
        name: string,
        serial = this.deps.scope.current,
    ): Promise<Registry | undefined> {
        return fetchRegistryWithRetry(name, serial, this);
    }

    get log() {
        return this.deps.log;
    }

    get statusSink() {
        return this.deps.statusSink;
    }

    get probeResult() {
        return this.probe.result;
    }

    setMetadataEndpoint(endpoint: string) {
        this.metadataEndpoint = endpoint;
    }

    /**
     * 重试轮次的端点顺序:首选端点(当前元数据端点降级判定后)+
     * 按评分排序的探测候选,去重保序(endpoints.ts 的 registryRetryEndpoints)。
     */
    retryEndpoints() {
        return registryRetryEndpoints({
            config: this.config,
            endpoint: this.endpoint,
            metadataEndpoint: this.metadataEndpoint,
            stats: this.routeState.stats,
            score: (item) => this.getRouteScore(item),
            log: this.deps.log,
        });
    }

    /** 多端点竞速拉取(route-fetch.ts,供 fetch 与 probe 共用)。 */
    fetchByRoute(
        name: string,
        endpoints: string[],
        serial: number,
        onAttempt?: (endpoint: string, attempts: number) => void,
    ) {
        return fetchRegistryByRoute(this.routeDeps, name, endpoints, serial, onAttempt);
    }
}
