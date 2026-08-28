import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouteStatsBook, type StatsPolicy } from "../../../racing/stats.js";
import { DAY } from "../../../utils/time.js";
import {
    clearRouteCooldowns,
    getEndpointCandidates,
    getRaceEndpoints,
    getRescueEndpoints,
    type MarketScoreContext,
    marketRouteScore,
} from "../endpoints.js";

const NOW = Date.parse("2026-01-01T00:00:00Z");
const GITEE = "https://gitee.com/shangxueink/koishi-registry-aggregator/raw/gh-pages/market.json";

function makePolicy(): StatsPolicy {
    return {
        fastThreshold: 800,
        successClamp: [-6, 3] as const,
        failureClamp: [-6, 3] as const,
        failurePenalty: () => 1.5,
        cooldown: () => 0,
        roundAverage: true,
        trackFailureMeta: false,
    };
}

function makeContext(overrides: Partial<MarketScoreContext> = {}): MarketScoreContext {
    return {
        config: {},
        stats: new RouteStatsBook(makePolicy()),
        cacheEntries: {},
        now: NOW,
        ...overrides,
    };
}

describe("getEndpointCandidates", () => {
    it("默认包含主端点 + 全部备用镜像（去重）", () => {
        const candidates = getEndpointCandidates({});
        expect(candidates[0]).toBe("https://registry.koishi.t4wefan.pub/index.json");
        expect(candidates.length).toBeGreaterThan(5);
        expect(new Set(candidates).size).toBe(candidates.length);
    });

    it("自定义主端点在首位", () => {
        const candidates = getEndpointCandidates({ endpoint: "https://custom.example/index.json" });
        expect(candidates[0]).toBe("https://custom.example/index.json");
    });

    it("autoRoute=false 只保留主端点", () => {
        expect(
            getEndpointCandidates({ endpoint: "https://custom.example", autoRoute: false }),
        ).toEqual(["https://custom.example"]);
        expect(getEndpointCandidates({ autoRoute: false })).toEqual([]);
    });

    it("主端点与镜像重复时去重", () => {
        const candidates = getEndpointCandidates({
            endpoint: "https://registry.koishi.t4wefan.pub/index.json",
        });
        expect(candidates[0]).toBe("https://registry.koishi.t4wefan.pub/index.json");
        expect(candidates.filter((item) => item === candidates[0])).toHaveLength(1);
    });
});

describe("marketRouteScore", () => {
    it("无统计时主端点基础分 1，其余 0", () => {
        const context = makeContext({ config: { endpoint: "https://a" } });
        expect(marketRouteScore("https://a", context)).toBe(1);
        expect(marketRouteScore("https://b", context)).toBe(0);
    });

    it("磁盘缓存新鲜度加分（相对无缓存）", () => {
        const plain = makeContext({ config: { endpoint: "https://a" } });
        const fresh = makeContext({
            config: { endpoint: "https://a" },
            cacheEntries: { "https://a": { fetchedAt: NOW - 60_000 } },
        });
        expect(
            marketRouteScore("https://a", fresh) - marketRouteScore("https://a", plain),
        ).toBeCloseTo(1.5);
        const stale = makeContext({
            config: { endpoint: "https://a" },
            cacheEntries: { "https://a": { fetchedAt: NOW - 2 * DAY } },
        });
        expect(
            marketRouteScore("https://a", stale) - marketRouteScore("https://a", plain),
        ).toBeCloseTo(0.5);
    });

    it("压缩编码加分（相对无编码）", () => {
        const plain = makeContext({ config: { endpoint: "https://a" } });
        plain.stats.recordSuccess("https://a", 100);
        const br = makeContext({ config: { endpoint: "https://a" } });
        br.stats.recordSuccess("https://a", 100, { contentEncoding: "br" });
        expect(
            marketRouteScore("https://a", br) - marketRouteScore("https://a", plain),
        ).toBeCloseTo(0.5);
        const gzip = makeContext({ config: { endpoint: "https://a" } });
        gzip.stats.recordSuccess("https://a", 100, { contentEncoding: "gzip" });
        expect(
            marketRouteScore("https://a", gzip) - marketRouteScore("https://a", plain),
        ).toBeCloseTo(0.2);
    });
});

describe("getRaceEndpoints", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("autoRoute=false 原样返回候选", () => {
        const context = makeContext({
            config: { endpoint: "https://custom.example", autoRoute: false },
        });
        expect(getRaceEndpoints(context)).toEqual(["https://custom.example"]);
    });

    it("主端点固定在首位，fallback 按评分降序稳定排序", () => {
        const context = makeContext({});
        context.stats.recordSuccess(GITEE, 200);
        const endpoints = getRaceEndpoints(context);
        expect(endpoints[0]).toBe("https://registry.koishi.t4wefan.pub/index.json");
        expect(endpoints[1]).toBe(GITEE);
    });

    it("冷却中的端点被排除", () => {
        const context = makeContext({});
        context.stats.recordSuccess(GITEE, 200);
        context.stats.get(GITEE)!.cooldownUntil = NOW + 60_000;
        const endpoints = getRaceEndpoints(context);
        expect(endpoints).not.toContain(GITEE);
    });

    it("无冷却且分数相同时保持原始顺序", () => {
        const context = makeContext({});
        const endpoints = getRaceEndpoints(context);
        expect(endpoints.slice(1)).toEqual(getEndpointCandidates({}).slice(1));
    });
});

describe("getRescueEndpoints", () => {
    it("autoRoute=false 无救援端点", () => {
        const context = makeContext({ config: { autoRoute: false } });
        expect(getRescueEndpoints(["https://a"], context)).toEqual([]);
    });

    it("返回未被激活端点覆盖的候选", () => {
        const context = makeContext({});
        const candidates = getEndpointCandidates({});
        const active = candidates.slice(0, 5);
        expect(getRescueEndpoints(active, context)).toEqual(candidates.slice(5));
    });
});

describe("clearRouteCooldowns", () => {
    it("清除冷却与连续失败", () => {
        const context = makeContext({});
        context.stats.recordSuccess(GITEE, 200);
        context.stats.get(GITEE)!.cooldownUntil = NOW + 60_000;
        context.stats.get(GITEE)!.consecutiveFailures = 3;
        clearRouteCooldowns(context.stats);
        expect(context.stats.get(GITEE)!.cooldownUntil).toBeUndefined();
        expect(context.stats.get(GITEE)!.consecutiveFailures).toBe(0);
    });
});
