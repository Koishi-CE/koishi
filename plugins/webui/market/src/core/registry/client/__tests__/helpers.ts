/**
 * @file registry client 域测试共享的 mock 工厂(core/registry/client 域)。
 *
 * 提供:真实形状的记分策略(与 node 层 wire.ts 一致)、记录型日志、
 * 最小 registry 元数据负载构造器、可编程 httpFactory 与各宿主 deps mock。
 * 全部为手工构造的 deps mock,不引入 koishi 运行时。
 */
import { vi } from "vitest";
import { RequestScope } from "../../../racing/request-scope.js";
import { RouteStatsBook, type StatsPolicy } from "../../../racing/stats.js";
import type { JsonStore } from "../../../utils/json-store.js";
import type { RegistryStatsStore } from "../../cache/stats-file.js";
import { formatRegistryError, type RegistryReason, registryFailurePenalty } from "../../errors.js";
import type { Registry, RemotePackage } from "../../manifest.js";
import type { RegistryClient, RegistryClientDeps } from "../index.js";
import type { RegistryHttpClient, RegistryRouteDeps } from "../route-fetch.js";

/** 测试用主端点(不在镜像列表中,便于区分)。 */
export const PRIMARY_ENDPOINT = "https://primary.example.com";

/** 测试用镜像端点(取源码镜像列表前两个,顺序敏感的断言用)。 */
export const MIRROR_TENCENT = "https://mirrors.cloud.tencent.com/npm";

/** 记录型日志 mock(debug/info/warn 均为 vi.fn,可直接断言)。 */
export function makeLog() {
    return { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

export type RecordingLog = ReturnType<typeof makeLog>;

/** registry 域真实记分策略(与 node 层 wire.ts 的构造保持一致)。 */
function makeRegistryStatsPolicy(): StatsPolicy {
    return {
        fastThreshold: 800,
        successClamp: [-6, 3] as const,
        failureClamp: [-8, 3] as const,
        failurePenalty: (options) =>
            Math.min(1.5, registryFailurePenalty(options.reason as RegistryReason | undefined)),
        cooldown: () => 0,
        roundAverage: true,
        trackFailureMeta: true,
    };
}

/** 新的路由统计本(真实 RouteStatsBook,真实记分策略)。 */
export function makeStats() {
    return new RouteStatsBook(makeRegistryStatsPolicy());
}

/** 新的竞速失效域。 */
export function makeScope() {
    return new RequestScope();
}

/** 最小测试版本的 RemotePackage(仅填充被测代码实际读取的字段)。 */
export function remotePackage(
    version: string,
    peerDependencies?: Record<string, string>,
    deprecated?: string,
): RemotePackage {
    return { version, peerDependencies, deprecated } as unknown as RemotePackage;
}

/** 最小可用的 registry 元数据负载(GET /<name> 的返回形状)。 */
export function makeRegistryPayload(
    versions: Array<{
        version: string;
        peerDependencies?: Record<string, string>;
        deprecated?: string;
    }> = [{ version: "1.0.0", peerDependencies: { koishi: "^4.0.0" } }],
): Registry {
    const map: Record<string, RemotePackage> = {};
    for (const item of versions) {
        map[item.version] = remotePackage(item.version, item.peerDependencies, item.deprecated);
    }
    return {
        name: "pkg",
        version: "1.0.0",
        description: "",
        versions: map,
        time: {},
        license: "",
        readme: "",
        readmeFilename: "",
    };
}

/** 带 response.status 的 HTTP 错误(cordis HTTP.Error 的最小形状)。 */
export function httpError(status: number, message = `HTTP ${status}`) {
    const error = new Error(message) as Error & { response?: { status?: number } };
    error.response = { status };
    return error;
}

/** 与 node 层注入一致的 isHttpError 判定(带 response 字段即视为 HTTP 错误)。 */
function isHttpStatusError(error: unknown) {
    return !!error && typeof error === "object" && "response" in error;
}

/** 用真实归因逻辑构造 formatError(errors.formatRegistryError 的直通)。 */
export function makeFormatError() {
    return (error: unknown) => formatRegistryError(error, isHttpStatusError);
}

/** 单端点的 get 处理器:返回负载(成功)/抛错(失败)。 */
export type HttpHandler = (path: string, config?: { signal?: AbortSignal }) => Promise<Registry>;

/** 可编程 httpFactory:按 endpoint 查表,未注册的端点一律失败。 */
export function makeHttpFactory(
    handlers: Record<string, HttpHandler | Registry | Error>,
): (endpoint: string) => RegistryHttpClient {
    return (endpoint: string): RegistryHttpClient => ({
        get: (path, config) => {
            const handler = handlers[endpoint];
            if (handler instanceof Error) return Promise.reject(handler);
            if (typeof handler === "function") return handler(path, config);
            if (handler) return Promise.resolve(handler);
            return Promise.reject(new Error(`no handler for endpoint: ${endpoint}`));
        },
    });
}

/** route-fetch 依赖面 mock(可整体或按字段覆盖)。 */
export function makeRouteDeps(overrides: Partial<RegistryRouteDeps> = {}): RegistryRouteDeps {
    return {
        httpFactory: makeHttpFactory({ [PRIMARY_ENDPOINT]: makeRegistryPayload() }),
        scope: makeScope(),
        log: { debug: vi.fn() },
        getFallbackDelay: vi.fn(() => 0),
        formatError: makeFormatError(),
        recordRouteSuccess: vi.fn(),
        recordRouteFailure: vi.fn(),
        ...overrides,
    };
}

/** RegistryClient 构造依赖 mock(真实 stats/scope + 可编程 http/日志)。 */
export function makeClientDeps(overrides: Partial<RegistryClientDeps> = {}): RegistryClientDeps {
    return {
        httpFactory: makeHttpFactory({ [PRIMARY_ENDPOINT]: makeRegistryPayload() }),
        isHttpError: isHttpStatusError,
        stats: makeStats(),
        statsFile: {
            schedule: vi.fn(),
            read: vi.fn(),
            write: vi.fn(),
        } as unknown as JsonStore<RegistryStatsStore>,
        scope: makeScope(),
        defaultEndpoint: vi.fn(async () => PRIMARY_ENDPOINT),
        statusSink: vi.fn(),
        log: makeLog(),
        ...overrides,
    };
}

/** PackageCache 依赖里的 RegistryClient 最小 mock(可编程 getRegistry)。 */
export function makeCacheClient(
    getRegistry: (name: string, serial: number) => Promise<Registry | undefined>,
): RegistryClient {
    return {
        getRegistry: vi.fn(getRegistry),
        formatError: makeFormatError(),
    } as unknown as RegistryClient;
}
