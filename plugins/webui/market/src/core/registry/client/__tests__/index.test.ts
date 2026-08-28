/**
 * index.ts 单测:RegistryClient 门面——端点复位/统计持久化/评分与降级/
 * retryEndpoints 排序,以及 getRegistry 的全链路(探测→复用→竞速→切换/失败)。
 * 组装真实 RouteProbe + 竞速器,仅 HTTP 通道走 mock。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RegistryStatsStore } from "../../cache/stats-file.js";
import { RegistryClient } from "../index.js";
import {
    httpError,
    MIRROR_TENCENT,
    makeClientDeps,
    makeHttpFactory,
    makeRegistryPayload,
    PRIMARY_ENDPOINT,
} from "./helpers.js";

const NOW = Date.parse("2026-01-01T00:00:00Z");

/** 与源码镜像列表一致的完整候选(端点状态展示/排序用例的期望基线)。 */
const ALL_ENDPOINTS = [
    PRIMARY_ENDPOINT,
    "https://registry.npmmirror.com",
    "https://mirrors.cloud.tencent.com/npm",
    "https://mirrors.huaweicloud.com/repository/npm",
    "https://registry.npmjs.org",
    "https://r.cnpmjs.org",
];

describe("RegistryClient.resetEndpoint", () => {
    it("配置端点优先,不触发默认端点探测", async () => {
        const deps = makeClientDeps();
        const client = new RegistryClient(deps, { endpoint: "https://configured" });
        await client.resetEndpoint();
        expect(client.endpoint).toBe("https://configured");
        expect(client.metadataEndpoint).toBe("https://configured");
        expect(deps.defaultEndpoint).not.toHaveBeenCalled();
    });

    it("未配置端点时回退默认端点来源", async () => {
        const deps = makeClientDeps();
        const client = new RegistryClient(deps);
        await client.resetEndpoint();
        expect(client.endpoint).toBe(PRIMARY_ENDPOINT);
        expect(deps.defaultEndpoint).toHaveBeenCalled();
    });

    it("端点真的变化时重置路由学习统计,首次复位与同端点复位不重置", async () => {
        const deps = makeClientDeps();
        const client = new RegistryClient(deps, { endpoint: "https://a" });
        await client.resetEndpoint();
        deps.stats.recordSuccess("https://a", 100);
        // 同端点复位:学习数据保留
        await client.resetEndpoint();
        expect(deps.stats.get("https://a")).toBeDefined();
        // 端点变化:整体作废并输出日志
        client.config.endpoint = "https://b";
        await client.resetEndpoint();
        expect(deps.stats.get("https://a")).toBeUndefined();
        expect(deps.log.info).toHaveBeenCalledWith(expect.stringContaining("endpoint changed"));
    });
});

describe("RegistryClient 统计持久化与评分", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("restoreStats 从持久化视图恢复学习数据", async () => {
        const deps = makeClientDeps();
        const client = new RegistryClient(deps);
        await client.resetEndpoint();
        const store: RegistryStatsStore = {
            version: 1,
            savedAt: NOW - 1000,
            stats: { "https://x": { score: 1, successes: 2, failures: 0, lastSuccess: NOW } },
        };
        await client.restoreStats(store);
        expect(deps.stats.get("https://x")).toMatchObject({ score: 1, successes: 2 });
    });

    it("scheduleStatsWrite 防抖写入当前统计快照", async () => {
        const deps = makeClientDeps();
        const client = new RegistryClient(deps);
        await client.resetEndpoint();
        deps.stats.recordSuccess(PRIMARY_ENDPOINT, 100);
        client.scheduleStatsWrite();
        const getData = vi.mocked(deps.statsFile.schedule).mock.calls[0]![0];
        expect(getData()).toMatchObject({
            version: 1,
            savedAt: NOW,
            stats: { [PRIMARY_ENDPOINT]: { successes: 1 } },
        });
    });

    it("getRouteScore 主端点有加分,getFallbackDelay 无统计时取快阈值", async () => {
        const deps = makeClientDeps();
        const client = new RegistryClient(deps, { endpoint: PRIMARY_ENDPOINT });
        await client.resetEndpoint();
        expect(client.getRouteScore(PRIMARY_ENDPOINT)).toBe(1);
        expect(client.getRouteScore("https://registry.npmjs.org")).toBe(0);
        expect(client.getFallbackDelay(PRIMARY_ENDPOINT)).toBe(800);
    });

    it("getRouteScores 输出全部候选且仅主端点带错峰延迟", async () => {
        const deps = makeClientDeps();
        const client = new RegistryClient(deps, { endpoint: PRIMARY_ENDPOINT });
        await client.resetEndpoint();
        const rows = client.getRouteScores();
        expect(rows.map((row) => row.endpoint)).toEqual(ALL_ENDPOINTS);
        expect(rows[0]!.fallbackDelay).toBe(800);
        expect(rows.slice(1).every((row) => row.fallbackDelay === undefined)).toBe(true);
    });

    it("getInstallFallbackCandidate 推荐非主端点的最优镜像;autoRoute 关闭时无推荐", async () => {
        const deps = makeClientDeps();
        const client = new RegistryClient(deps, { endpoint: PRIMARY_ENDPOINT });
        await client.resetEndpoint();
        const candidate = client.getInstallFallbackCandidate();
        expect(candidate).toBeDefined();
        expect(candidate!.endpoint).not.toBe(PRIMARY_ENDPOINT);

        const disabled = new RegistryClient(makeClientDeps(), {
            endpoint: PRIMARY_ENDPOINT,
            autoRoute: false,
        });
        await disabled.resetEndpoint();
        expect(disabled.getInstallFallbackCandidate()).toBeUndefined();
    });
});

describe("RegistryClient.retryEndpoints", () => {
    it("常规:首选当前元数据端点,其余按评分排序且去重保序", async () => {
        const deps = makeClientDeps();
        const client = new RegistryClient(deps, { endpoint: PRIMARY_ENDPOINT });
        await client.resetEndpoint();
        client.setMetadataEndpoint(MIRROR_TENCENT);
        const endpoints = client.retryEndpoints();
        expect(endpoints[0]).toBe(MIRROR_TENCENT);
        expect(endpoints).toEqual([...new Set(endpoints)]);
        expect(endpoints).toHaveLength(ALL_ENDPOINTS.length);
    });

    it("元数据端点连续失败且评分劣化时降级回主端点", async () => {
        const deps = makeClientDeps();
        const client = new RegistryClient(deps, { endpoint: PRIMARY_ENDPOINT });
        await client.resetEndpoint();
        client.setMetadataEndpoint(MIRROR_TENCENT);
        deps.stats.recordFailure(MIRROR_TENCENT, { reason: "network" });
        deps.stats.recordFailure(MIRROR_TENCENT, { reason: "network" });
        expect(client.retryEndpoints()[0]).toBe(PRIMARY_ENDPOINT);
    });
});

describe("RegistryClient.getRegistry 全链路", () => {
    it("首个请求:探测竞速主端点胜出,负载直接复用(仅一次 HTTP)", async () => {
        const get = vi.fn(async () => makeRegistryPayload());
        // routeDeps 在构造时固化 httpFactory,须在构造前注入
        const deps = makeClientDeps({
            httpFactory: makeHttpFactory({ [PRIMARY_ENDPOINT]: get }),
        });
        const client = new RegistryClient(deps, { endpoint: PRIMARY_ENDPOINT });
        await client.resetEndpoint();

        const registry = await client.getRegistry("pkg");
        expect(registry).toBeDefined();
        expect(get).toHaveBeenCalledTimes(1);
        expect(client.probeResult).toMatchObject({ name: "pkg", endpoint: PRIMARY_ENDPOINT });
        // 探测胜出被记录为一次成功路由
        expect(deps.stats.get(PRIMARY_ENDPOINT)?.successes).toBe(1);
        const statuses = vi.mocked(deps.statusSink).mock.calls.map((call) => call[1]);
        expect(statuses.at(-1)).toMatchObject({ loading: false, endpoint: PRIMARY_ENDPOINT });
    });

    it("第二个包:探测负载不复用,按重试端点竞速拉取", async () => {
        const get = vi.fn(async () => makeRegistryPayload());
        const deps = makeClientDeps({
            httpFactory: makeHttpFactory({ [PRIMARY_ENDPOINT]: get }),
        });
        const client = new RegistryClient(deps, { endpoint: PRIMARY_ENDPOINT });
        await client.resetEndpoint();

        await client.getRegistry("first");
        const registry = await client.getRegistry("second");
        expect(registry).toBeDefined();
        expect(get).toHaveBeenCalledTimes(2);
    });

    it("主端点网络失败、镜像胜出:切换元数据端点并输出路由日志", async () => {
        const deps = makeClientDeps({
            httpFactory: makeHttpFactory({
                "https://example.com": new Error("fetch failed"),
                [MIRROR_TENCENT]: makeRegistryPayload(),
            }),
        });
        const client = new RegistryClient(deps, { endpoint: "https://example.com" });
        await client.resetEndpoint();

        const registry = await client.getRegistry("pkg");
        expect(registry).toBeDefined();
        expect(client.metadataEndpoint).toBe(MIRROR_TENCENT);
        expect(deps.log.info).toHaveBeenCalledWith(
            expect.stringContaining("npm registry route selected"),
        );
    });

    it("全部端点 404:探测仅告警,最终失败归因 not-found 且不惩罚镜像", async () => {
        const handlers: Record<string, Error> = {};
        for (const endpoint of ALL_ENDPOINTS) handlers[endpoint] = httpError(404);
        const deps = makeClientDeps({ httpFactory: makeHttpFactory(handlers) });
        const client = new RegistryClient(deps, { endpoint: PRIMARY_ENDPOINT });
        await client.resetEndpoint();

        const error = await client.getRegistry("pkg").catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(Error);
        expect((error as { marketNextReason?: string }).marketNextReason).toBe("not-found");
        expect(deps.log.warn).toHaveBeenCalledWith(expect.stringContaining("route probe failed"));
        expect(deps.stats.get(PRIMARY_ENDPOINT)?.failures).toBeUndefined();
        const statuses = vi.mocked(deps.statusSink).mock.calls.map((call) => call[1]);
        expect(statuses.at(-1)?.reason).toBe("not-found");
    });

    it("autoRoute 关闭:不探测,单端点直接竞速拉取", async () => {
        const get = vi.fn(async () => makeRegistryPayload());
        const deps = makeClientDeps({
            httpFactory: makeHttpFactory({ [PRIMARY_ENDPOINT]: get }),
        });
        const client = new RegistryClient(deps, {
            endpoint: PRIMARY_ENDPOINT,
            autoRoute: false,
        });
        await client.resetEndpoint();

        const registry = await client.getRegistry("pkg");
        expect(registry).toBeDefined();
        expect(client.probeResult).toBeUndefined();
        expect(get).toHaveBeenCalledTimes(1);
    });

    it("formatError 透传注入的 isHttpError 判定", () => {
        const client = new RegistryClient(makeClientDeps());
        expect(client.formatError(httpError(404)).reason).toBe("not-found");
        expect(client.formatError(new Error("request timeout")).reason).toBe("timeout");
    });
});
