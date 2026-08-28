/**
 * @file 单端点索引拉取(core/market/source 域)。
 *
 * 职责:fetchMarketEndpoint 对单个端点发起条件请求(etag/last-modified),
 * 按响应分派:304 → 复用磁盘缓存;200 → 内容哈希比对,命中则复用缓存
 * 对象,未命中才 JSON.parse。HTTP 通道抽象为 MarketHttp 接口注入,
 * core 层不直接依赖 koishi 的网络栈。
 *
 * 关键设计:每次 await 后都校验 scope.isStale,竞速被新一轮请求 superseded
 * 时立即以 "market provider disposed" 终止,不再浪费后续处理。
 */
import type { SearchResult } from "@koishi-ce/registry";
import type { RequestScope } from "../../racing/request-scope.js";
import {
    formatError,
    formatStack,
    normalizeWireSize,
    parseContentLength,
} from "../../utils/format.js";
import type { CacheEntry, CacheFile } from "../types.js";
import {
    buildHashCacheResult,
    type EndpointRequest,
    matchHashCache,
    parseNetworkResult,
    resolveFrom304Cache,
} from "./endpoint-results.js";

/** HTTP 通道抽象:按 endpoint 取一个带 getText 的客户端(由 node 层注入)。 */
export interface MarketHttp {
    getText(
        path: string,
        config: {
            headers: Record<string, string>;
            signal?: AbortSignal | undefined;
            validateStatus: (status: number) => boolean;
        },
    ): Promise<{ status: number; data: string; headers: { get(name: string): string | null } }>;
}

/** 单端点拉取结果(source 仅 network/http-304/hash-cache 三种)。 */
export interface EndpointFetchResult {
    endpoint: string;
    result: SearchResult;
    elapsed: number;
    candidates: number;
    source: "network" | "http-304" | "hash-cache";
    timings: Record<string, number>;
    size: number | undefined;
    wireSize: number | undefined;
    contentEncoding: string | undefined;
    hash: string | undefined;
    etag: string | undefined;
    lastModified: string | undefined;
    cachedAt: number | undefined;
    validatedAt: number | undefined;
}

/** 单端点拉取所需依赖面:HTTP 通道、竞速域、缓存读取与条件头。 */
export interface FetchEndpointDeps {
    http: (endpoint: string) => MarketHttp;
    scope: RequestScope;
    getCachedEntry: (endpoint: string) => CacheEntry | undefined;
    loadCacheEntryResult: (entry: CacheEntry) => Promise<CacheFile | undefined>;
    conditionalHeaders: (endpoint: string) => Record<string, string>;
    log: { debug(message: string): void; warn(message: string): void };
}

/** 发起条件请求（etag/last-modified），返回统一请求上下文。 */
async function requestMarketIndex(
    deps: FetchEndpointDeps,
    endpoint: string,
    serial: number,
    signal?: AbortSignal,
): Promise<EndpointRequest> {
    const conditional = deps.conditionalHeaders(endpoint);
    const headers = { "accept-encoding": "br,gzip,deflate", ...conditional };
    const requestStart = Date.now();
    const response = await deps.http(endpoint).getText("", {
        headers,
        signal,
        // 304 与 2xx 都算成功,其余状态码由 getText 抛错交给竞速处理
        validateStatus: (status) => status === 304 || (status >= 200 && status < 300),
    });
    if (deps.scope.isStale(serial)) throw new Error("market provider disposed");
    return {
        response,
        requestElapsed: Date.now() - requestStart,
        etag: response.headers.get("etag") || undefined,
        lastModified: response.headers.get("last-modified") || undefined,
        contentEncoding: response.headers.get("content-encoding") || undefined,
        headerWireSize: parseContentLength(response.headers.get("content-length")),
    };
}

/** 处理 200 响应体：哈希比对 → hash-cache 复用或网络解析。 */
async function resolveNetworkBody(
    deps: FetchEndpointDeps,
    endpoint: string,
    total: number,
    start: number,
    request: EndpointRequest,
    cachedEntry: CacheEntry | undefined,
): Promise<EndpointFetchResult> {
    const text = request.response.data;
    const size = Buffer.byteLength(text);
    const wireSize = normalizeWireSize(request.headerWireSize, size);
    const { hash, hashElapsed, cache: hashCache } = await matchHashCache(deps, text, cachedEntry);
    if (hashCache) {
        return buildHashCacheResult(
            deps,
            endpoint,
            total,
            start,
            request,
            hash,
            hashElapsed,
            size,
            wireSize,
            hashCache,
        );
    }
    return parseNetworkResult(
        deps,
        endpoint,
        total,
        start,
        request,
        text,
        size,
        wireSize,
        hash,
        hashElapsed,
    );
}

/**
 * 单端点索引拉取：条件请求（etag/last-modified）→ 304 复用 → 内容哈希比对复用 →
 * 解析网络体。成块移植自旧 MarketProvider.fetchEndpoint。
 */
export async function fetchMarketEndpoint(
    deps: FetchEndpointDeps,
    endpoint: string,
    index: number,
    total: number,
    serial: number,
    warnFailure = true,
    signal?: AbortSignal,
): Promise<EndpointFetchResult> {
    if (deps.scope.isStale(serial)) throw new Error("market provider disposed");
    const start = Date.now();
    try {
        const request = await requestMarketIndex(deps, endpoint, serial, signal);
        const cachedEntry = deps.getCachedEntry(endpoint);
        if (request.response.status === 304) {
            return await resolveFrom304Cache(deps, endpoint, total, start, request, cachedEntry);
        }
        return await resolveNetworkBody(deps, endpoint, total, start, request, cachedEntry);
    } catch (error) {
        if (deps.scope.isStale(serial)) throw new Error("market provider disposed");
        // warnFailure=false:竞速落败的中止类失败不值得刷屏告警
        if (warnFailure) {
            deps.log.warn(
                `market endpoint fetch failed: endpoint=${endpoint}, elapsed=${Date.now() - start}ms, error=${formatError(error)}`,
            );
        }
        deps.log.debug(
            `market endpoint error detail: endpoint=${endpoint}, index=${index + 1}/${total}, elapsed=${Date.now() - start}ms, stack=${formatStack(error)}`,
        );
        throw error;
    }
}
