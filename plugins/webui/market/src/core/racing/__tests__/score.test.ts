import { describe, expect, it } from "vitest";
import { MINUTE } from "../../utils/time.js";
import { registryFallbackDelay, routeScore } from "../score.js";
import type { RouteStats } from "../stats.js";

const NOW = Date.parse("2026-01-01T00:00:00Z");

function stats(overrides: Partial<RouteStats> = {}): RouteStats {
    return { score: 0, successes: 0, failures: 0, ...overrides };
}

describe("routeScore", () => {
    it("无统计时仅主端点/附加分", () => {
        expect(routeScore(undefined, { isPrimary: true, fastThreshold: 500 })).toBe(1);
        expect(routeScore(undefined, { isPrimary: false, fastThreshold: 500 })).toBe(0);
        expect(
            routeScore(undefined, { isPrimary: false, fastThreshold: 500, extraScore: 1.5 }),
        ).toBe(1.5);
    });

    it("成功率加权与高成功率奖励", () => {
        expect(
            routeScore(stats({ successes: 3, failures: 1 }), {
                isPrimary: true,
                fastThreshold: 500,
            }),
        ).toBeCloseTo(3.05);
        expect(
            routeScore(stats({ successes: 4, failures: 1 }), {
                isPrimary: true,
                fastThreshold: 500,
            }),
        ).toBeCloseTo(5.1);
    });

    it("低成功率惩罚", () => {
        expect(
            routeScore(stats({ successes: 1, failures: 3 }), {
                isPrimary: true,
                fastThreshold: 500,
            }),
        ).toBeCloseTo(-2.85);
    });

    it("延迟分档", () => {
        const base = { isPrimary: true, fastThreshold: 500 } as const;
        expect(routeScore(stats({ averageElapsed: 400 }), base)).toBe(2);
        expect(routeScore(stats({ averageElapsed: 500 }), base)).toBe(2);
        expect(routeScore(stats({ averageElapsed: 501 }), base)).toBe(1.5);
        expect(routeScore(stats({ averageElapsed: 1201 }), base)).toBeCloseTo(0.7);
        expect(routeScore(stats({ averageElapsed: 3000 }), base)).toBe(0);
        expect(routeScore(stats({ averageElapsed: 5000 }), base)).toBe(-1);
    });

    it("近期成功加分，过期不加", () => {
        const recent = stats({ successes: 1, failures: 0, lastSuccess: NOW - 5 * MINUTE });
        expect(routeScore(recent, { isPrimary: false, fastThreshold: 500, now: NOW })).toBeCloseTo(
            4.75,
        );
        const stale = stats({ successes: 1, failures: 0, lastSuccess: NOW - 11 * MINUTE });
        expect(routeScore(stale, { isPrimary: false, fastThreshold: 500, now: NOW })).toBeCloseTo(
            3.25,
        );
    });

    it("连续失败惩罚（上限 5）", () => {
        expect(
            routeScore(stats({ consecutiveFailures: 4 }), { isPrimary: false, fastThreshold: 500 }),
        ).toBe(-5);
        expect(
            routeScore(stats({ consecutiveFailures: 10 }), {
                isPrimary: false,
                fastThreshold: 500,
            }),
        ).toBe(-5);
    });
});

describe("registryFallbackDelay", () => {
    it("无统计返回阈值", () => {
        expect(registryFallbackDelay(undefined, 800)).toBe(800);
    });

    it("近期有成功时不按失败收紧", () => {
        const s = stats({ failures: 3, lastSuccess: Date.now() - 60_000 });
        expect(registryFallbackDelay(s, 800)).toBe(800);
    });

    it("连续失败收紧等待", () => {
        expect(registryFallbackDelay(stats({ failures: 3 }), 800)).toBe(200);
        expect(registryFallbackDelay(stats({ failures: 2 }), 800)).toBe(400);
        expect(registryFallbackDelay(stats({ failures: 1 }), 800)).toBe(800);
    });

    it("高延迟收紧等待", () => {
        expect(registryFallbackDelay(stats({ averageElapsed: 5000 }), 800)).toBe(400);
        expect(registryFallbackDelay(stats({ averageElapsed: 3000 }), 800)).toBe(600);
        expect(registryFallbackDelay(stats({ averageElapsed: 1000 }), 800)).toBe(800);
    });
});
