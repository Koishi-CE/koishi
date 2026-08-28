import { describe, expect, it } from "vitest";
import { isLegacyInlineCacheStore, normalizeCacheStore } from "../normalize.js";

describe("normalizeCacheStore", () => {
    it("非法/空输入返回空 store", () => {
        expect(normalizeCacheStore(undefined)).toEqual({ version: 3, entries: {} });
        expect(normalizeCacheStore(null)).toEqual({ version: 3, entries: {} });
        expect(normalizeCacheStore("x")).toEqual({ version: 3, entries: {} });
    });

    it("单条目内联形式被包装", () => {
        const store = normalizeCacheStore({
            endpoint: "https://a",
            fetchedAt: 123,
            result: { objects: [{}, {}] },
        });
        expect(store.version).toBe(3);
        expect(store.entries["https://a"]).toMatchObject({ endpoint: "https://a", fetchedAt: 123 });
        expect(store.lastUsed).toBe("https://a");
    });

    it("v2 store 迁移到 v3，非法条目被丢弃", () => {
        const store = normalizeCacheStore({
            version: 2,
            entries: {
                a: { endpoint: "https://a", fetchedAt: 1, result: { objects: [] } },
                bad: { endpoint: "https://bad" }, // 缺 fetchedAt
            },
        });
        expect(store.version).toBe(3);
        expect(Object.keys(store.entries)).toEqual(["https://a"]);
    });

    it("routeStats 归一化并 clamp", () => {
        const store = normalizeCacheStore({
            version: 3,
            entries: {},
            routeStats: {
                a: {
                    score: 99,
                    averageElapsed: 500,
                    consecutiveFailures: 2,
                    contentEncoding: "br",
                },
                bad: { score: "not-a-number" },
            },
        });
        expect(store.routeStats).toEqual({
            a: {
                score: 3,
                averageElapsed: 500,
                consecutiveFailures: 2,
                contentEncoding: "br",
            },
        });
    });

    it("无合法 routeStats 时省略该字段", () => {
        const store = normalizeCacheStore({
            version: 3,
            entries: {},
            routeStats: { bad: { score: "x" } },
        });
        expect(store.routeStats).toBeUndefined();
    });
});

describe("isLegacyInlineCacheStore", () => {
    it("v3 拆分布局不是内联", () => {
        expect(isLegacyInlineCacheStore({ version: 3, entries: { a: { file: "x.json" } } })).toBe(
            false,
        );
    });

    it("检测 v3 内联 result.objects 与旧版本", () => {
        expect(
            isLegacyInlineCacheStore({ version: 3, entries: { a: { result: { objects: [] } } } }),
        ).toBe(true);
        expect(isLegacyInlineCacheStore({ version: 2, entries: {} })).toBe(true);
        expect(isLegacyInlineCacheStore(undefined)).toBe(false);
    });
});
