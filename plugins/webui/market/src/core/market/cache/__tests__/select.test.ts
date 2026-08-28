/**
 * select.ts 纯函数单测:缓存条目评分(cacheEntryScore)、回放候选构建
 * (buildCacheCandidates)与上限淘汰(pruneCacheEntries)。
 *
 * 策略:fake timers 锁定 NOW,评分断言以"同上下文相对差值"为主,
 * 避免对共享评分核心(racing/score)的绝对数值形成双重维护。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouteStatsBook, type StatsPolicy } from "../../../racing/stats.js";
import { DAY, HOUR } from "../../../utils/time.js";
import type { MarketScoreContext } from "../../source/endpoints.js";
import type { CacheEntry } from "../../types.js";
import { buildCacheCandidates, cacheEntryScore, pruneCacheEntries } from "../select.js";

const NOW = Date.parse("2026-01-01T00:00:00Z");
const PRIMARY = "https://primary.example";

function makePolicy(): StatsPolicy {
    return {
        fastThreshold: 500,
        successClamp: [-4, 3] as const,
        failureClamp: [-4, 3] as const,
        failurePenalty: () => 1,
        cooldown: () => 0,
        roundAverage: false,
        trackFailureMeta: false,
    };
}

function makeContext(overrides: Partial<MarketScoreContext> = {}): MarketScoreContext {
    return {
        config: { endpoint: PRIMARY },
        stats: new RouteStatsBook(makePolicy()),
        cacheEntries: {},
        now: NOW,
        ...overrides,
    };
}

function makeEntry(
    endpoint: string,
    fetchedAt: number,
    extra: Partial<CacheEntry> = {},
): CacheEntry {
    return { endpoint, fetchedAt, ...extra };
}

describe("cacheEntryScore", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("新鲜度分档:半天内 +3、3 天内 +1、更旧 -1", () => {
        const context = makeContext();
        const fresh = cacheEntryScore(makeEntry("https://mirror.example", NOW - 6 * HOUR), context);
        const mid = cacheEntryScore(makeEntry("https://mirror.example", NOW - 2 * DAY), context);
        const old = cacheEntryScore(makeEntry("https://mirror.example", NOW - 10 * DAY), context);
        expect(fresh - mid).toBe(2);
        expect(mid - old).toBe(2);
    });

    it("用户首选端点在路由评分与首选加分上均占优", () => {
        const context = makeContext();
        const preferred = cacheEntryScore(makeEntry(PRIMARY, NOW - HOUR), context);
        const mirror = cacheEntryScore(makeEntry("https://mirror.example", NOW - HOUR), context);
        // 路由评分主端点基础分 +1,缓存首选端点再 +0.5
        expect(preferred - mirror).toBeCloseTo(1.5);
    });

    it("fetchedAt 非有限值按最旧档计分", () => {
        const context = makeContext();
        const broken = cacheEntryScore(makeEntry("https://mirror.example", Number.NaN), context);
        const oldest = cacheEntryScore(
            makeEntry("https://mirror.example", NOW - 40 * DAY),
            context,
        );
        expect(broken).toBe(oldest);
    });

    it("磁盘缓存条目经路由评分给新鲜端点加分", () => {
        const plain = makeContext();
        const cached = makeContext({
            cacheEntries: { "https://mirror.example": { fetchedAt: NOW - 60_000 } },
        });
        expect(
            cacheEntryScore(makeEntry("https://mirror.example", NOW - HOUR), cached) -
                cacheEntryScore(makeEntry("https://mirror.example", NOW - HOUR), plain),
        ).toBeCloseTo(1.5);
    });
});

describe("buildCacheCandidates", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("排除主端点与无索引引用的条目,列表外端点不参与", () => {
        const endpoints = [PRIMARY, "https://a.example", "https://b.example", "https://c.example"];
        const entries: Record<string, CacheEntry> = {
            [PRIMARY]: makeEntry(PRIMARY, NOW - HOUR, { file: "primary.json" }),
            "https://a.example": makeEntry("https://a.example", NOW - 2 * HOUR, {
                file: "a.json",
            }),
            "https://b.example": makeEntry("https://b.example", NOW - 3 * HOUR, {
                result: { objects: [] } as never,
            }),
            "https://c.example": makeEntry("https://c.example", NOW - HOUR),
            "https://outside.example": makeEntry("https://outside.example", NOW - HOUR, {
                file: "outside.json",
            }),
        };
        const candidates = buildCacheCandidates(endpoints, entries, makeContext());
        // c 无 file 无 result 被过滤;outside 不在候选列表;primary 位被 slice(1) 排除
        expect(candidates.map((entry) => entry.endpoint)).toEqual([
            "https://a.example",
            "https://b.example",
        ]);
    });

    it("评分降序优先,并列时更新鲜者在前", () => {
        const endpoints = [PRIMARY, "https://fresh.example", "https://stale.example"];
        const entries: Record<string, CacheEntry> = {
            // stale 条目 fetchedAt 更新,但落在 3 天档(+1)输给 fresh 条目的半天档(+3)
            "https://fresh.example": makeEntry("https://fresh.example", NOW - 8 * HOUR, {
                file: "fresh.json",
            }),
            "https://stale.example": makeEntry("https://stale.example", NOW - 2 * DAY, {
                file: "stale.json",
            }),
        };
        const ranked = buildCacheCandidates(endpoints, entries, makeContext());
        expect(ranked.map((entry) => entry.endpoint)).toEqual([
            "https://fresh.example",
            "https://stale.example",
        ]);

        const tied: Record<string, CacheEntry> = {
            "https://fresh.example": makeEntry("https://fresh.example", NOW - 1 * HOUR, {
                file: "fresh.json",
            }),
            "https://stale.example": makeEntry("https://stale.example", NOW - 2 * HOUR, {
                file: "stale.json",
            }),
        };
        const tiedRanked = buildCacheCandidates(endpoints, tied, makeContext());
        // 同为半天档时并列,按 fetchedAt 降序取更新鲜的
        expect(tiedRanked.map((entry) => entry.endpoint)).toEqual([
            "https://fresh.example",
            "https://stale.example",
        ]);
    });
});

describe("pruneCacheEntries", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("过滤无索引引用与超过 30 天 TTL 的条目", () => {
        const entries: Record<string, CacheEntry> = {
            kept: makeEntry("https://kept.example", NOW - HOUR, { file: "kept.json" }),
            noRef: makeEntry("https://noref.example", NOW - HOUR),
            expired: makeEntry("https://expired.example", NOW - 31 * DAY, {
                file: "expired.json",
            }),
        };
        const pruned = pruneCacheEntries(entries, "https://kept.example", makeContext());
        expect(Object.keys(pruned)).toEqual(["https://kept.example"]);
    });

    it("lastUsed 与用户首选端点优先,超出上限截取 3 条", () => {
        const entries: Record<string, CacheEntry> = {
            used: makeEntry("https://used.example", NOW - 4 * HOUR, { file: "used.json" }),
            preferred: makeEntry(PRIMARY, NOW - 5 * HOUR, { file: "preferred.json" }),
            n1: makeEntry("https://n1.example", NOW - 1 * HOUR, { file: "n1.json" }),
            n2: makeEntry("https://n2.example", NOW - 2 * HOUR, { file: "n2.json" }),
            n3: makeEntry("https://n3.example", NOW - 3 * HOUR, { file: "n3.json" }),
        };
        const pruned = pruneCacheEntries(entries, "https://used.example", makeContext());
        // used 因 lastUsed、preferred 因用户首选排前,剩余按"评分高/更新鲜"取第三名
        expect(Object.keys(pruned)).toEqual([
            "https://used.example",
            "https://primary.example",
            "https://n1.example",
        ]);
    });

    it("返回以 endpoint 为键的新字典", () => {
        const entry = makeEntry("https://a.example", NOW - HOUR, { file: "a.json" });
        const pruned = pruneCacheEntries(
            { a: entry, b: makeEntry("https://b.example", NOW - HOUR) },
            "https://a.example",
            makeContext(),
        );
        expect(pruned["https://a.example"]).toBe(entry);
        expect(pruned["https://b.example"]).toBeUndefined();
    });
});
