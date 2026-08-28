/**
 * host.ts 纯函数单测:性能调试信息的合并(mergeMarketPerformance)与
 * 对外暴露门控(exportMarketPerformance)。
 *
 * 策略:以最小性能快照 fixture 验证"字段覆盖、timings 浅合并、
 * phase 归档、logLevel 门控"四个语义点;createSourceSnapshotHost
 * 是 MarketIndexSource 的视图适配器,由 node/market 集成测试覆盖。
 */

import { describe, expect, it } from "vitest";
import type { MarketPerformance, MarketPerformanceSnapshot } from "../../../../shared/types.js";
import { exportMarketPerformance, mergeMarketPerformance } from "../host.js";

function makeSnapshot(
    overrides: Partial<MarketPerformanceSnapshot> = {},
): MarketPerformanceSnapshot {
    return {
        source: "network",
        endpoint: "https://a.example",
        objects: 10,
        hash: "h1",
        timings: { request: 100 },
        ...overrides,
    } as MarketPerformanceSnapshot;
}

describe("mergeMarketPerformance", () => {
    it("无历史信息时以新快照为底", () => {
        const info = makeSnapshot();
        const next = mergeMarketPerformance(undefined, info);
        expect(next.endpoint).toBe("https://a.example");
        expect(next.timings).toEqual({ request: 100 });
        // 未指定 phase 时不归档
        expect("initial" in next).toBe(false);
        expect("refresh" in next).toBe(false);
    });

    it("新快照字段覆盖旧值,timings 按阶段浅合并", () => {
        const current = {
            ...makeSnapshot({ endpoint: "https://old.example" }),
            timings: { request: 50, hash: 20 },
        };
        const next = mergeMarketPerformance(current, makeSnapshot(), undefined);
        expect(next.endpoint).toBe("https://a.example");
        expect(next.timings).toEqual({ request: 100, hash: 20 });
    });

    it("指定 phase 时把该轮快照整体归档", () => {
        const next = mergeMarketPerformance(undefined, makeSnapshot(), "initial");
        expect(next.initial).toEqual(makeSnapshot());
    });
});

describe("exportMarketPerformance", () => {
    it("logLevel 非 debug 时对外隐藏性能信息", () => {
        expect(
            exportMarketPerformance("warn", makeSnapshot() as MarketPerformance, undefined),
        ).toBeUndefined();
    });

    it("debug 且未追加 timings 时原样返回当前信息", () => {
        const current = makeSnapshot() as MarketPerformance;
        expect(exportMarketPerformance("debug", current, undefined)).toBe(current);
    });

    it("debug 且追加 timings 时浅合并,旧 timings 键兜底", () => {
        const current = {
            ...makeSnapshot(),
            timings: { request: 50, parse: 30 },
        } as MarketPerformance;
        expect(exportMarketPerformance("debug", current, { request: 100 })).toEqual({
            ...current,
            timings: { request: 100, parse: 30 },
        });
    });
});
