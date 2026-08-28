/**
 * @file registry 路由学习状态管理(core/registry/client 域)。
 *
 * RouteStateTracker 把 RegistryClient 的路由状态职责收拢:成功/失败记录
 * (recordRoute* 系列)、防抖持久化(scheduleWrite)、启动恢复(restore)、
 * 端点集合失效时整体作废(reset),以及评分与竞速错峰延迟查询。评分走
 * racing/score 共享核心,主端点加分、快阈值 800ms。
 *
 * 架构位置:被 RegistryClient(registry-client.ts)组合;stats 原始视图
 * 暴露给 endpoints 系列纯函数(降级判定/评分表/备用源推荐)消费。
 */
import { registryFallbackDelay, routeScore } from "../../racing/score.js";
import type { RouteStatsBook } from "../../racing/stats.js";
import type { JsonStore } from "../../utils/json-store.js";
import {
    type RegistryStatsStore,
    restoreRegistryStats,
    serializeRegistryStats,
} from "../cache/stats-file.js";
import type { RegistryReason } from "../errors.js";

/** "快端点"阈值:800ms 内返回视为快(评分与慢端点降级阈值)。 */
const FAST_ROUTE_THRESHOLD = 800;

/** RouteStateTracker 的构造注入面:统计本、持久化文件与日志。 */
export interface RouteStateDeps {
    /** 路由学习统计本 */
    stats: RouteStatsBook;
    /** 路由统计持久化文件(防抖写) */
    statsFile: JsonStore<RegistryStatsStore>;
    log: { debug(message: string): void };
}

/** 路由学习状态:记录、持久化、恢复与评分查询(成块移植自 RegistryClient)。 */
export class RouteStateTracker {
    private readonly deps: RouteStateDeps;

    constructor(deps: RouteStateDeps) {
        this.deps = deps;
    }

    /** 原始统计视图(endpoints 系列纯函数与降级判定消费)。 */
    get stats() {
        return this.deps.stats;
    }

    /** 从持久化文件恢复路由学习统计(启动时调用)。 */
    restore(store: RegistryStatsStore | undefined) {
        restoreRegistryStats(this.deps.stats, store, (message) => this.deps.log.debug(message));
    }

    /** 防抖写路由统计到 statsFile(每次成功/失败记录后调用)。 */
    scheduleWrite() {
        this.deps.statsFile.schedule(() => ({
            version: 1,
            stats: serializeRegistryStats(this.deps.stats),
            savedAt: Date.now(),
        }));
    }

    /** 记录成功路由并触发持久化(RegistryClient.recordRouteSuccess 委托)。 */
    recordSuccess(result: { endpoint: string; elapsed: number }) {
        this.deps.stats.recordSuccess(result.endpoint, result.elapsed);
        this.scheduleWrite();
    }

    /** 记录失败路由并触发持久化(RegistryClient.recordRouteFailure 委托)。 */
    recordFailure(endpoint: string, reason?: RegistryReason) {
        this.deps.stats.recordFailure(endpoint, { reason });
        this.scheduleWrite();
    }

    /** 端点集合失效时整体作废学习数据(resetEndpoint 端点变化时调用)。 */
    reset() {
        this.deps.stats.reset();
    }

    /** 单端点评分:共享评分核心,主端点加分,快阈值 800ms。 */
    score(endpoint: string, isPrimary: boolean) {
        return routeScore(this.deps.stats.get(endpoint), {
            isPrimary,
            fastThreshold: FAST_ROUTE_THRESHOLD,
        });
    }

    /** 端点的竞速错峰延迟(慢端点延迟启动,给快端点先手机会)。 */
    fallbackDelay(endpoint: string) {
        return registryFallbackDelay(this.deps.stats.get(endpoint), FAST_ROUTE_THRESHOLD);
    }
}
