/**
 * fetch.ts 单测:带重试的元数据获取主循环(fetchRegistryWithRetry)——
 * 探测负载复用、成功收口/端点切换、线性退避重试、最终失败归因上报。
 * 宿主能力面(RegistryFetchHost)全部手工 mock。
 */
import { describe, expect, it, vi } from "vitest";
import type { RaceAttempt } from "../../../racing/race.js";
import { attachRegistryAttemptReasons } from "../../errors.js";
import type { RegistryFetchHost } from "../fetch.js";
import { fetchRegistryWithRetry } from "../fetch.js";
import { makeFormatError, makeLog, makeRegistryPayload, PRIMARY_ENDPOINT } from "./helpers.js";

type Registry = ReturnType<typeof makeRegistryPayload>;

function payloadOf(): Registry {
    return makeRegistryPayload();
}

/** 可变 probeResult 的宿主 mock 工厂。 */
function makeFetchHost(
    options: {
        probeResult?: RegistryFetchHost["probeResult"];
        metadataEndpoint?: string;
        retry?: number;
        fetchByRoute?: RegistryFetchHost["fetchByRoute"];
        isStale?: (serial: number) => boolean;
    } = {},
) {
    let probeResult = options.probeResult;
    const host: RegistryFetchHost = {
        scope: { isStale: options.isStale ?? (() => false), current: 7 },
        config: { retry: options.retry ?? 1 },
        log: makeLog(),
        formatError: makeFormatError(),
        statusSink: vi.fn(),
        ensureMetadataEndpoint: vi.fn(),
        get probeResult() {
            return probeResult;
        },
        metadataEndpoint: options.metadataEndpoint ?? PRIMARY_ENDPOINT,
        setMetadataEndpoint: vi.fn(),
        retryEndpoints: () => [PRIMARY_ENDPOINT, "https://mirror.example.com"],
        fetchByRoute:
            options.fetchByRoute ??
            (vi.fn(async () => attemptOf()) as unknown as RegistryFetchHost["fetchByRoute"]),
    };
    return {
        host,
        setProbeResult: (value: RegistryFetchHost["probeResult"]) => {
            probeResult = value;
        },
    };
}

function attemptOf(overrides: Partial<RaceAttempt<Registry>> = {}): RaceAttempt<Registry> {
    return {
        endpoint: PRIMARY_ENDPOINT,
        payload: makeRegistryPayload(),
        elapsed: 10,
        ...overrides,
    };
}

describe("fetchRegistryWithRetry", () => {
    it("探测负载与当前请求匹配时直接复用,不再竞速", async () => {
        const payload = makeRegistryPayload();
        const { host } = makeFetchHost({
            probeResult: {
                serial: 7,
                name: "pkg",
                endpoint: PRIMARY_ENDPOINT,
                registry: payload,
                elapsed: 5,
            },
        });
        const result = await fetchRegistryWithRetry("pkg", 7, host);
        expect(result).toBe(payload);
        expect(host.fetchByRoute).not.toHaveBeenCalled();
        const calls = vi.mocked(host.statusSink).mock.calls;
        expect(calls.at(-1)?.[1]).toMatchObject({
            loading: false,
            endpoint: PRIMARY_ENDPOINT,
            attempts: 1,
        });
        expect(host.log.debug).toHaveBeenCalledWith(expect.stringContaining("reuse"));
    });

    it("复用条件不匹配(轮次/包名/端点)时走正常竞速", async () => {
        const mismatches: RegistryFetchHost["probeResult"][] = [
            {
                serial: 6,
                name: "pkg",
                endpoint: PRIMARY_ENDPOINT,
                registry: payloadOf(),
                elapsed: 5,
            },
            {
                serial: 7,
                name: "other",
                endpoint: PRIMARY_ENDPOINT,
                registry: payloadOf(),
                elapsed: 5,
            },
            {
                serial: 7,
                name: "pkg",
                endpoint: "https://mirror.example.com",
                registry: payloadOf(),
                elapsed: 5,
            },
        ];
        for (const probeResult of mismatches) {
            const { host } = makeFetchHost({ probeResult });
            const result = await fetchRegistryWithRetry("pkg", 7, host);
            expect(result).toBeDefined();
            expect(host.fetchByRoute).toHaveBeenCalledTimes(1);
        }
    });

    it("竞速胜出端点与当前元数据端点不同时切换并输出路由日志", async () => {
        const { host } = makeFetchHost({
            fetchByRoute: vi.fn(async () =>
                attemptOf({
                    endpoint: "https://mirror.example.com",
                    fallbackReason: "primary-slow",
                }),
            ) as unknown as RegistryFetchHost["fetchByRoute"],
        });
        const result = await fetchRegistryWithRetry("pkg", 7, host);
        expect(result).toBeDefined();
        expect(host.setMetadataEndpoint).toHaveBeenCalledWith("https://mirror.example.com");
        expect(host.log.info).toHaveBeenCalledWith(expect.stringContaining("route selected"));
    });

    it("胜出端点无降级原因时路由日志记为 same-priority", async () => {
        const { host } = makeFetchHost({
            fetchByRoute: vi.fn(async () =>
                attemptOf({ endpoint: "https://mirror.example.com" }),
            ) as unknown as RegistryFetchHost["fetchByRoute"],
        });
        await fetchRegistryWithRetry("pkg", 7, host);
        expect(host.log.info).toHaveBeenCalledWith(expect.stringContaining("reason=same-priority"));
    });

    it("竞速胜出端点即当前元数据端点时不切换", async () => {
        const { host } = makeFetchHost();
        await fetchRegistryWithRetry("pkg", 7, host);
        expect(host.setMetadataEndpoint).not.toHaveBeenCalled();
        expect(host.log.info).not.toHaveBeenCalled();
    });

    it("首轮失败后线性退避重试,次轮成功返回负载", async () => {
        const networkError = new Error("fetch failed");
        attachRegistryAttemptReasons(networkError, ["network"]);
        const fetchByRoute = vi.fn();
        fetchByRoute.mockRejectedValueOnce(networkError);
        fetchByRoute.mockResolvedValueOnce(attemptOf());
        const { host } = makeFetchHost({
            fetchByRoute: fetchByRoute as unknown as RegistryFetchHost["fetchByRoute"],
        });
        const result = await fetchRegistryWithRetry("pkg", 7, host);
        expect(result).toBeDefined();
        expect(fetchByRoute).toHaveBeenCalledTimes(2);
        expect(host.log.debug).toHaveBeenCalledWith(
            expect.stringContaining("failed routed registry metadata"),
        );
    });

    it("全部轮次失败:合并归因上报并以属性形式挂到异常上", async () => {
        const error = new Error("fetch failed");
        const { host } = makeFetchHost({
            fetchByRoute: vi.fn(async () => {
                throw error;
            }) as unknown as RegistryFetchHost["fetchByRoute"],
        });
        await expect(fetchRegistryWithRetry("pkg", 7, host)).rejects.toThrow("fetch failed");
        const calls = vi.mocked(host.statusSink).mock.calls;
        expect(calls.at(-1)).toMatchObject([
            "pkg",
            { loading: false, reason: "network", endpoint: PRIMARY_ENDPOINT },
            7,
        ]);
        expect(host.log.warn).toHaveBeenCalledWith(expect.stringContaining("failed to fetch"));
        expect((error as { marketNextReason?: string }).marketNextReason).toBe("network");
        expect((error as { marketNextReasons?: string[] }).marketNextReasons).toContain("network");
    });

    it("多路由归因含非 not-found 原因时最终 reason 取首个非 404", async () => {
        const error = new Error("boom");
        attachRegistryAttemptReasons(error, ["not-found", "timeout"]);
        const { host } = makeFetchHost({
            retry: 0,
            fetchByRoute: vi.fn(async () => {
                throw error;
            }) as unknown as RegistryFetchHost["fetchByRoute"],
        });
        await expect(fetchRegistryWithRetry("pkg", 7, host)).rejects.toThrow("boom");
        expect((error as { marketNextReason?: string }).marketNextReason).toBe("timeout");
        expect(vi.mocked(host.statusSink).mock.calls.at(-1)?.[1]?.reason).toBe("timeout");
    });

    it("非对象异常不挂归因属性但原样上抛", async () => {
        const { host } = makeFetchHost({
            retry: 0,
            fetchByRoute: vi.fn(async () => {
                throw "boom";
            }) as unknown as RegistryFetchHost["fetchByRoute"],
        });
        await expect(fetchRegistryWithRetry("pkg", 7, host)).rejects.toBe("boom");
        expect(vi.mocked(host.statusSink).mock.calls.at(-1)?.[1]?.reason).toBe("unknown");
    });

    it("每次端点尝试都会递增 attempts 并上报中间状态", async () => {
        const fetchByRoute = vi.fn(((
            _name: string,
            _endpoints: string[],
            _serial: number,
            onAttempt?: (endpoint: string, attempts: number) => void,
        ) => {
            onAttempt?.(PRIMARY_ENDPOINT, 1);
            onAttempt?.("https://mirror.example.com", 2);
            return Promise.resolve(attemptOf());
        }) as unknown as RegistryFetchHost["fetchByRoute"]);
        const { host } = makeFetchHost({ fetchByRoute });
        const result = await fetchRegistryWithRetry("pkg", 7, host);
        expect(result).toBeDefined();
        const statuses = vi.mocked(host.statusSink).mock.calls.map((call) => call[1]);
        expect(statuses[1]).toMatchObject({
            loading: true,
            endpoint: PRIMARY_ENDPOINT,
            attempts: 1,
        });
        expect(statuses[2]).toMatchObject({
            loading: true,
            endpoint: "https://mirror.example.com",
            attempts: 2,
        });
        expect(statuses.at(-1)).toMatchObject({ loading: false, attempts: 2 });
    });

    it("探测完成后请求已过期:返回 undefined 且不再竞速", async () => {
        const { host } = makeFetchHost({ isStale: (serial) => serial !== 7 });
        await expect(fetchRegistryWithRetry("pkg", 8, host)).resolves.toBeUndefined();
        expect(host.ensureMetadataEndpoint).toHaveBeenCalled();
        expect(host.fetchByRoute).not.toHaveBeenCalled();
    });

    it("竞速成功后请求过期:返回 undefined 且不上报成功", async () => {
        let stale = false;
        const fetchByRoute = vi.fn(async () => {
            stale = true;
            return attemptOf();
        }) as unknown as RegistryFetchHost["fetchByRoute"];
        const { host } = makeFetchHost({ isStale: () => stale, fetchByRoute });
        await expect(fetchRegistryWithRetry("pkg", 7, host)).resolves.toBeUndefined();
        const statuses = vi.mocked(host.statusSink).mock.calls.map((call) => call[1]);
        expect(statuses.at(-1)?.loading).toBe(true);
        expect(host.setMetadataEndpoint).not.toHaveBeenCalled();
    });

    it("负 retry 收敛为单轮", async () => {
        const fetchByRoute = vi.fn(async () =>
            attemptOf(),
        ) as unknown as RegistryFetchHost["fetchByRoute"];
        const { host } = makeFetchHost({ retry: -1, fetchByRoute });
        await fetchRegistryWithRetry("pkg", 7, host);
        expect(fetchByRoute).toHaveBeenCalledTimes(1);
    });
});
