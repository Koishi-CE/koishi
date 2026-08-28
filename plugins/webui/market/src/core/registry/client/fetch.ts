/**
 * @file registry 元数据的带重试获取主循环(core/registry/client 域)。
 *
 * fetchRegistryWithRetry 是 getRegistry 的流程本体:先确保路由探测完成,
 * 探测负载与当前请求匹配时直接复用(省一次请求);否则按 retryEndpoints
 * 的顺序逐轮竞速拉取,失败按 300ms*(轮次+1) 线性退避重试;最终失败时
 * 汇总各轮失败归因(marketNextReason(s) 挂到异常上)并上报状态后上抛。
 * loading/失败状态的上报辅助(report 系列)位于 fetch-report.ts。
 *
 * 架构位置:被 RegistryClient.getRegistry 调用,通过 RegistryFetchHost
 * (RegistryClient 实现)访问路由/状态/日志等宿主能力。
 */
import { getRegistryAttemptReasons } from "../../../shared/dependency-source.js";
import type { RegistryStatus } from "../../../shared/types.js";
import type { RaceAttempt } from "../../racing/race.js";
import { sleep } from "../../utils/async.js";
import type { RegistryErrorDetail, RegistryReason } from "../errors.js";
import type { Registry } from "../manifest.js";
import { reportFetchFailure, reportLoadingStatus } from "./fetch-report.js";
import type { RouteProbeResult } from "./probe.js";

/** 获取主循环所需的宿主能力面(RegistryClient 的结构性视图)。 */
export interface RegistryFetchHost {
    scope: { isStale(serial: number): boolean; current: number };
    config: { retry?: number | undefined };
    log: {
        debug(message: string): void;
        info(message: string): void;
        warn(message: string): void;
    };
    formatError(error: unknown): RegistryErrorDetail;
    statusSink: (name: string, status: Partial<RegistryStatus>, serial: number) => void;
    ensureMetadataEndpoint(name: string, serial: number): Promise<void>;
    readonly probeResult: RouteProbeResult | undefined;
    readonly metadataEndpoint: string;
    setMetadataEndpoint(endpoint: string): void;
    retryEndpoints(): string[];
    fetchByRoute(
        name: string,
        endpoints: string[],
        serial: number,
        onAttempt?: (endpoint: string, attempts: number) => void,
    ): Promise<RaceAttempt<Registry>>;
}

/** 路由探测负载匹配当前请求时直接复用，避免重复请求。 */
function tryReuseProbePayload(
    name: string,
    serial: number,
    start: number,
    host: RegistryFetchHost,
): Registry | undefined {
    const probeResult = host.probeResult;
    // 复用条件:同一请求轮次(serial)、同一包、且胜出端点仍是当前元数据端点
    if (
        probeResult?.serial !== serial ||
        probeResult.name !== name ||
        probeResult.endpoint !== host.metadataEndpoint
    ) {
        return;
    }
    host.statusSink(
        name,
        {
            loading: false,
            error: undefined,
            reason: undefined,
            endpoint: probeResult.endpoint,
            attempts: 1,
            elapsed: Date.now() - start,
        },
        serial,
    );
    host.log.debug(
        `reuse npm registry route probe payload for ${name}: endpoint=${probeResult.endpoint}, probeElapsed=${probeResult.elapsed}ms`,
    );
    return probeResult.registry;
}

/** debug 输出本轮重试的候选端点。 */
function logRetryCandidates(
    name: string,
    endpoints: string[],
    retry: number,
    maxRetry: number,
    host: RegistryFetchHost,
) {
    host.log.debug(
        `registry metadata candidates for ${name}: endpoints=${endpoints.join(", ")}, retry=${retry + 1}/${maxRetry + 1}`,
    );
}

/** 竞速成功：必要时切换端点、上报成功状态并返回负载。 */
function completeFetchAttempt(
    name: string,
    result: RaceAttempt<Registry>,
    attempts: number,
    start: number,
    serial: number,
    host: RegistryFetchHost,
): Registry {
    if (result.endpoint !== host.metadataEndpoint) {
        host.log.info(
            `npm registry route selected for ${name}: endpoint=${result.endpoint}, previous=${host.metadataEndpoint}, reason=${result.fallbackReason ?? "same-priority"}, elapsed=${result.elapsed}ms`,
        );
        host.setMetadataEndpoint(result.endpoint);
    }
    host.statusSink(
        name,
        {
            loading: false,
            error: undefined,
            reason: undefined,
            endpoint: result.endpoint,
            attempts,
            elapsed: Date.now() - start,
        },
        serial,
    );
    return result.payload;
}

/** 记录失败归因并按需退避重试。 */
async function recordRoutedFetchFailure(
    name: string,
    retry: number,
    maxRetry: number,
    error: unknown,
    lastEndpoint: string,
    attempts: number,
    failureReasons: RegistryReason[],
    host: RegistryFetchHost,
) {
    const detail = host.formatError(error);
    failureReasons.push(
        ...getRegistryAttemptReasons(error, detail.reason).filter(
            (reason): reason is RegistryReason => !!reason,
        ),
    );
    host.log.debug(
        `failed routed registry metadata for ${name}, attempt=${retry + 1}/${maxRetry + 1}, endpoint=${lastEndpoint}, attempts=${attempts}: ${detail.error}`,
    );
    // 线性退避:第一轮失败等 300ms,第二轮 600ms,依此类推
    if (retry < maxRetry) await sleep(300 * (retry + 1));
}

/**
 * 带重试的元数据获取主循环（旧 Installer.getRegistry 主体）：
 * 预热路由探测 → 复用探测负载 → 逐轮竞速 → 失败归因上抛。
 */
export async function fetchRegistryWithRetry(
    name: string,
    serial: number,
    host: RegistryFetchHost,
): Promise<Registry | undefined> {
    const start = Date.now();
    const maxRetry = Math.max(0, host.config.retry ?? 1);
    let attempts = 0;
    let lastError: unknown;
    let lastEndpoint = host.metadataEndpoint;
    const failureReasons: RegistryReason[] = [];
    reportLoadingStatus(name, lastEndpoint, attempts, serial, host);

    // 先用一个探针包探测出最优端点(单飞,多个包共享同一次探测)
    await host.ensureMetadataEndpoint(name, serial);
    if (host.scope.isStale(serial)) return undefined;

    const reused = tryReuseProbePayload(name, serial, start, host);
    if (reused) return reused;

    for (let retry = 0; retry <= maxRetry; retry++) {
        const endpoints = host.retryEndpoints();
        logRetryCandidates(name, endpoints, retry, maxRetry, host);
        try {
            const result = await host.fetchByRoute(name, endpoints, serial, (endpoint) => {
                attempts++;
                lastEndpoint = endpoint;
                host.statusSink(name, { loading: true, endpoint, attempts }, serial);
            });
            if (host.scope.isStale(serial)) return undefined;
            return completeFetchAttempt(name, result, attempts, start, serial, host);
        } catch (error) {
            lastError = error;
            await recordRoutedFetchFailure(
                name,
                retry,
                maxRetry,
                error,
                lastEndpoint,
                attempts,
                failureReasons,
                host,
            );
        }
    }
    reportFetchFailure(name, lastError, failureReasons, lastEndpoint, attempts, start, host);
    throw lastError ?? new Error(`failed to fetch registry metadata for ${name}`);
}
