import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouteStatsBook, type StatsPolicy } from "../stats.js";

const NOW = Date.parse("2026-01-01T00:00:00Z");

function makePolicy(overrides: Partial<StatsPolicy> = {}): StatsPolicy {
    return {
        fastThreshold: 800,
        successClamp: [-6, 3] as const,
        failureClamp: [-6, 3] as const,
        failurePenalty: ({ reason }) => (reason === "not-found" ? 0.4 : 1.5),
        cooldown: (n) => Math.min(60_000, n * 10_000),
        roundAverage: true,
        trackFailureMeta: true,
        ...overrides,
    };
}

describe("RouteStatsBook", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("recordSuccess 初始化并记录快速/慢速加分与 EWMA", () => {
        const book = new RouteStatsBook(makePolicy());
        book.recordSuccess("a", 500);
        expect(book.get("a")).toEqual({
            score: 0.4,
            successes: 1,
            failures: 0,
            consecutiveFailures: 0,
            cooldownUntil: undefined,
            lastSuccess: NOW,
            averageElapsed: 500,
        });
        book.recordSuccess("a", 900);
        const entry = book.get("a")!;
        expect(entry.successes).toBe(2);
        expect(entry.score).toBeCloseTo(0.5); // 0.4 + 0.1
        expect(entry.averageElapsed).toBe(620); // round(500*0.7 + 900*0.3)
    });

    it("recordFailure 递增失败、冷却与扣分，并记录元数据", () => {
        const book = new RouteStatsBook(makePolicy());
        book.recordSuccess("a", 500);
        book.recordFailure("a", { reason: "network" });
        const entry = book.get("a")!;
        expect(entry.failures).toBe(1);
        expect(entry.consecutiveFailures).toBe(1);
        expect(entry.cooldownUntil).toBe(NOW + 10_000);
        expect(entry.score).toBeCloseTo(0.4 - 1.5);
        expect(entry.lastFailure).toBe(NOW);
        expect(entry.lastFailureReason).toBe("network");
    });

    it("not-found 扣分较轻", () => {
        const book = new RouteStatsBook(makePolicy());
        book.recordFailure("a", { reason: "not-found" });
        expect(book.get("a")!.score).toBeCloseTo(-0.4);
    });

    it("rescue 模式不累计连续失败与冷却", () => {
        const book = new RouteStatsBook(makePolicy());
        book.recordSuccess("a", 500);
        book.recordFailure("a", { rescue: true });
        const entry = book.get("a")!;
        expect(entry.consecutiveFailures).toBe(0);
        expect(entry.cooldownUntil).toBeUndefined();
        expect(entry.failures).toBe(1);
        expect(entry.score).toBeCloseTo(0.4 - 1.5);
    });

    it("成功清零连续失败并收敛失败计数", () => {
        const book = new RouteStatsBook(makePolicy());
        book.recordFailure("a", {});
        book.recordFailure("a", {});
        book.recordSuccess("a", 500);
        const entry = book.get("a")!;
        expect(entry.consecutiveFailures).toBe(0);
        expect(entry.failures).toBe(1); // floor(2 * 0.6)
        expect(entry.cooldownUntil).toBeUndefined();
    });

    it("score 被 clamp 在 successClamp/failureClamp 内", () => {
        const book = new RouteStatsBook(makePolicy());
        for (let i = 0; i < 20; i++) book.recordSuccess("a", 100);
        expect(book.get("a")!.score).toBe(3);
        const book2 = new RouteStatsBook(makePolicy());
        for (let i = 0; i < 20; i++) book2.recordFailure("a", {});
        expect(book2.get("a")!.score).toBe(-6);
    });

    it("roundAverage=false 时保留小数 EWMA", () => {
        const book = new RouteStatsBook(makePolicy({ roundAverage: false }));
        book.recordSuccess("a", 500);
        book.recordSuccess("a", 900);
        expect(book.get("a")!.averageElapsed).toBeCloseTo(620);
    });

    it("reset 清空全部统计", () => {
        const book = new RouteStatsBook(makePolicy());
        book.recordSuccess("a", 500);
        book.reset();
        expect(book.get("a")).toBeUndefined();
        expect(Object.keys(book.stats)).toEqual([]);
    });
});
