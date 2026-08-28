/**
 * endpoints.ts 单测:候选端点生成与排序(sortRouteProbeEndpoints)、
 * 元数据端点降级判定(preferredMetadataEndpoint)、调试评分表
 * (registryRouteScores)与安装失败后的备用源推荐(installFallbackCandidate)。
 */
import { describe, expect, it, vi } from "vitest";
import type { RouteStats, RouteStatsBook } from "../../../racing/stats.js";
import {
    installFallbackCandidate,
    preferredMetadataEndpoint,
    type RouteScoreFn,
    registryRouteScores,
    sortRouteProbeEndpoints,
} from "../endpoints.js";
import { makeLog, makeStats } from "./helpers.js";

/** 源码镜像列表的硬拷贝(顺序敏感断言的期望基线)。 */
const MIRRORS = [
    "https://registry.npmmirror.com",
    "https://mirrors.cloud.tencent.com/npm",
    "https://mirrors.huaweicloud.com/repository/npm",
    "https://registry.npmjs.org",
    "https://r.cnpmjs.org",
] as const;

/** 从映射构造轻量 stats book(只需 get)。 */
function statsBookOf(map: Record<string, Partial<RouteStats>>): RouteStatsBook {
    return { get: (endpoint: string) => map[endpoint] } as unknown as RouteStatsBook;
}

describe("sortRouteProbeEndpoints", () => {
    it("autoRoute 关闭时只返回主端点", () => {
        expect(sortRouteProbeEndpoints({ autoRoute: false }, "https://a", () => 0)).toEqual([
            "https://a",
        ]);
    });

    it("主端点固定在首位,镜像按评分降序排列", () => {
        const scores: Record<string, number> = {
            "https://registry.npmmirror.com": 3,
            "https://mirrors.cloud.tencent.com/npm": 1,
            "https://mirrors.huaweicloud.com/repository/npm": 2,
            "https://registry.npmjs.org": 5,
            "https://r.cnpmjs.org": 0,
        };
        const score: RouteScoreFn = (endpoint) => scores[endpoint] ?? 0;
        expect(sortRouteProbeEndpoints({}, "https://a", score)).toEqual([
            "https://a",
            "https://registry.npmjs.org",
            "https://registry.npmmirror.com",
            "https://mirrors.huaweicloud.com/repository/npm",
            "https://mirrors.cloud.tencent.com/npm",
            "https://r.cnpmjs.org",
        ]);
    });

    it("评分并列时保持镜像列表原始顺序(tie-breaker)", () => {
        expect(sortRouteProbeEndpoints({}, "https://a", () => 1)).toEqual([
            "https://a",
            ...MIRRORS,
        ]);
    });

    it("主端点与镜像重复时去重", () => {
        const result = sortRouteProbeEndpoints({}, MIRRORS[1]!, () => 0);
        // 传入的主端点(tencent)占据首位,镜像列表中重复项被剔除
        expect(result).toEqual([MIRRORS[1]!, MIRRORS[0]!, ...MIRRORS.slice(2)]);
        expect(new Set(result).size).toBe(MIRRORS.length);
    });

    it("主端点为空且 autoRoute 关闭时返回空数组", () => {
        expect(sortRouteProbeEndpoints({ autoRoute: false }, "", () => 0)).toEqual([]);
    });
});

describe("preferredMetadataEndpoint", () => {
    const endpoint = "https://a";

    function makeOptions(overrides: Partial<Parameters<typeof preferredMetadataEndpoint>[0]> = {}) {
        const options = {
            endpoint,
            metadataEndpoint: "https://mirror",
            stats: statsBookOf({}),
            score: vi.fn(() => 0) as RouteScoreFn,
            log: makeLog(),
            ...overrides,
        };
        return options;
    }

    it("所选即主端点时直接返回,不查统计不评分", () => {
        const options = makeOptions({ metadataEndpoint: endpoint });
        expect(preferredMetadataEndpoint(options)).toBe(endpoint);
        expect(options.score).not.toHaveBeenCalled();
    });

    it("所选端点无统计时保持原选择", () => {
        expect(preferredMetadataEndpoint(makeOptions())).toBe("https://mirror");
    });

    it("连续失败不足 2 次时保持原选择", () => {
        const options = makeOptions({ stats: statsBookOf({ "https://mirror": { failures: 1 } }) });
        expect(preferredMetadataEndpoint(options)).toBe("https://mirror");
    });

    it("连续失败但评分差距不足 1 分时保持原选择", () => {
        const options = makeOptions({
            stats: statsBookOf({ "https://mirror": { failures: 3 } }),
            score: (item) => (item === endpoint ? 5 : 4.5),
        });
        expect(preferredMetadataEndpoint(options)).toBe("https://mirror");
    });

    it("连续失败 ≥2 且评分显著低于主端点时降级回主端点", () => {
        const log = makeLog();
        const options = makeOptions({
            stats: statsBookOf({ "https://mirror": { failures: 2 } }),
            score: (item) => (item === endpoint ? 5 : 3),
            log,
        });
        expect(preferredMetadataEndpoint(options)).toBe(endpoint);
        expect(log.debug).toHaveBeenCalledWith(expect.stringContaining("demote"));
    });
});

describe("registryRouteScores", () => {
    it("主端点带错峰延迟,镜像延迟为 undefined,并展开统计明细", () => {
        const book = makeStats();
        book.recordSuccess("https://registry.npmjs.org", 100);
        const rows = registryRouteScores({
            config: {},
            endpoint: "https://a",
            stats: book,
            score: () => 0,
            fallbackDelay: (item) => (item === "https://a" ? 800 : undefined),
        });
        expect(rows).toHaveLength(6);
        const primaryRow = rows.find((row) => row.endpoint === "https://a")!;
        expect(primaryRow.fallbackDelay).toBe(800);
        expect(
            rows
                .filter((row) => row.endpoint !== "https://a")
                .every((row) => row.fallbackDelay === undefined),
        ).toBe(true);
        const npmjsRow = rows.find((row) => row.endpoint === "https://registry.npmjs.org")!;
        expect(npmjsRow.successes).toBe(1);
    });

    it("autoRoute 关闭时只输出主端点一行", () => {
        const rows = registryRouteScores({
            config: { autoRoute: false },
            endpoint: "https://a",
            stats: makeStats(),
            score: () => 0,
            fallbackDelay: () => 123,
        });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ endpoint: "https://a", fallbackDelay: 123 });
    });
});

describe("installFallbackCandidate", () => {
    function makeOptions(overrides: Partial<Parameters<typeof installFallbackCandidate>[0]> = {}) {
        return {
            config: {},
            endpoint: "https://a",
            stats: statsBookOf({}),
            score: (() => 0) as RouteScoreFn,
            ...overrides,
        };
    }

    it("autoRoute 关闭时无推荐", () => {
        expect(
            installFallbackCandidate(makeOptions({ config: { autoRoute: false } })),
        ).toBeUndefined();
    });

    it("排除失败端点与用户配置端点后按评分取最优", () => {
        const options = makeOptions({
            config: { endpoint: "https://registry.npmjs.org" },
            score: (item) => (item === "https://registry.npmjs.org" ? 9 : 0),
        });
        // npmjs 分最高但被用户配置排除,退而取镜像列表首个
        const candidate = installFallbackCandidate(options);
        expect(candidate?.endpoint).toBe(MIRRORS[0]);
        expect(candidate?.label).toBe("registry.npmmirror.com");
        expect(candidate?.reason).toBe("备用 npm 源");
    });

    it("尾斜杠归一后排除同一镜像", () => {
        const options = makeOptions({
            endpoint: `${MIRRORS[0]}/`,
            score: (item) => (item === MIRRORS[0] ? 9 : 0),
        });
        const candidate = installFallbackCandidate(options);
        expect(candidate?.endpoint).not.toBe(MIRRORS[0]);
    });

    it("评分并列时最近成功过的端点优先", () => {
        const options = makeOptions({
            stats: statsBookOf({
                [MIRRORS[0]]: { lastSuccess: 1000 },
                [MIRRORS[1]]: { lastSuccess: 2000 },
            }),
            score: () => 1,
        });
        expect(installFallbackCandidate(options)?.endpoint).toBe(MIRRORS[1]);
    });

    it("评分与最近成功时间都并列时按镜像列表原始顺序", () => {
        const options = makeOptions({
            stats: statsBookOf({
                [MIRRORS[1]]: { lastSuccess: 500 },
                [MIRRORS[2]]: { lastSuccess: 500 },
            }),
            score: () => 1,
        });
        expect(installFallbackCandidate(options)?.endpoint).toBe(MIRRORS[1]);
    });

    it("胜出端点最近成功过时推荐文案带【最近可用】", async () => {
        const options = makeOptions({
            stats: statsBookOf({ [MIRRORS[2]]: { lastSuccess: Date.now() } }),
            score: () => 1,
        });
        expect(installFallbackCandidate(options)).toMatchObject({
            endpoint: MIRRORS[2],
            reason: "最近可用的备用 npm 源",
        });
    });
});
