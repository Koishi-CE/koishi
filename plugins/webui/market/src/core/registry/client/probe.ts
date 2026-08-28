/**
 * @file 元数据路由探测(core/registry/client 域)。
 *
 * RouteProbe 在后端生命周期内做一次"探针包竞速":用一个包把全部候选
 * 端点跑一遍,胜出的端点成为后续请求默认走的 metadataEndpoint,
 * 探测负载(result.registry)在同包同轮次请求中直接复用,省一次请求。
 * 探测失败不致命:仅告警,后续请求自行走 retryEndpoints 竞速。
 */
import type { RaceAttempt } from "../../racing/race.js";
import type { RequestScope } from "../../racing/request-scope.js";
import type { Registry } from "../manifest.js";

/** 探测结果(serial/name 匹配时可直接复用 registry 负载)。 */
export interface RouteProbeResult {
    /** 探测发起时的请求序号(复用判定) */
    serial: number;
    /** 探针包名 */
    name: string;
    /** 胜出端点 */
    endpoint: string;
    /** 探针包的元数据(可复用的负载) */
    registry: Registry;
    /** 竞速耗时(ms) */
    elapsed: number;
    /** 非主端点胜出时的原因(主端点失败/过慢) */
    fallbackReason?: "primary-failed" | "primary-slow" | undefined;
}

/** RouteProbe 的依赖面:竞速域、日志与评分摘要。 */
export interface RouteProbeDeps {
    scope: RequestScope;
    log: {
        debug(message: string): void;
        info(message: string): void;
        warn(message: string): void;
    };
    /** 探测后的评分摘要（debug 日志） */
    scoresSummary: () => string;
}

type FetchByRoute = (
    name: string,
    endpoints: string[],
    serial: number,
) => Promise<RaceAttempt<Registry>>;

/**
 * 每个后端生命周期一次的元数据路由探测：用一个探针包竞速全部候选端点，
 * 选出后续请求默认走的 metadataEndpoint。移植自旧 Installer 的探测三方法。
 */
export class RouteProbe {
    /** 进行中的探测任务(单飞去重) */
    task: Promise<void> | undefined;
    /** 最近一次探测结果(未探测/已重置为 undefined) */
    result: RouteProbeResult | undefined;
    private readonly deps: RouteProbeDeps;

    constructor(deps: RouteProbeDeps) {
        this.deps = deps;
    }

    /** 清空探测状态(端点重置时调用,下次 ensure 重新探测)。 */
    reset() {
        this.task = undefined;
        this.result = undefined;
    }

    /**
     * 确保探测已完成:无任务则发起(单飞),已有任务直接等待。
     * 无探针包或只有一个候选端点时跳过(无从竞速)。
     */
    async ensure(name: string, endpoints: string[], serial: number, fetchByRoute: FetchByRoute) {
        if (!name || endpoints.length <= 1) return;
        if (!this.task) {
            this.task = this.probe(name, endpoints, serial, fetchByRoute);
        }
        await this.task;
    }

    private async probe(
        name: string,
        endpoints: string[],
        serial: number,
        fetchByRoute: FetchByRoute,
    ) {
        const start = Date.now();
        this.deps.log.info(
            `npm registry route probe started: probe=${name}, primary=${endpoints[0]}, fallbackCount=${Math.max(0, endpoints.length - 1)}`,
        );
        try {
            const result = await fetchByRoute(name, endpoints, serial);
            // 过期结果不落 result:避免旧探测负载被新一轮请求误复用
            if (this.deps.scope.isStale(serial)) return;
            this.apply(name, result, serial, start);
        } catch {
            if (this.deps.scope.isStale(serial)) return;
            // 探测失败不抛出:调用方按普通请求流程继续,自会竞速选出端点
            this.deps.log.warn(
                `npm registry route probe failed: probe=${name}, candidates=${endpoints.length}, elapsed=${Date.now() - start}ms`,
            );
        }
    }

    /** 记录探测结果并输出胜出端点与原因(primary 选中或降级)。 */
    private apply(name: string, result: RaceAttempt<Registry>, serial: number, start: number) {
        this.result = {
            serial,
            name,
            endpoint: result.endpoint,
            registry: result.payload,
            elapsed: result.elapsed,
            fallbackReason: result.fallbackReason,
        };
        if (result.fallbackReason) {
            this.deps.log.info(
                `npm registry fallback selected: probe=${name}, endpoint=${result.endpoint}, reason=${result.fallbackReason}, elapsed=${result.elapsed}ms, total=${Date.now() - start}ms`,
            );
        } else {
            this.deps.log.info(
                `npm registry primary selected: probe=${name}, endpoint=${result.endpoint}, elapsed=${result.elapsed}ms, total=${Date.now() - start}ms`,
            );
        }
        this.deps.log.debug(`npm registry route scores after probe: ${this.deps.scoresSummary()}`);
    }
}
