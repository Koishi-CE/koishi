/**
 * state.ts 纯函数单测:拉取成功后的状态计算(applyEndpointResult,
 * 穿透 persistence.buildCacheMeta 的合并语义)与条件请求头计算
 * (buildConditionalHeaders)。
 *
 * 策略:fake timers 锁定 NOW,让 fetchedAt 的 Date.now 兜底可精确断言;
 * 304/换端点/兜底链各构造独立用例。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOUR } from "../../../utils/time.js";
import type { EndpointResult } from "../../types.js";
import { applyEndpointResult, buildConditionalHeaders } from "../state.js";

const NOW = Date.parse("2026-01-01T00:00:00Z");
const ENDPOINT = "https://a.example";

function makeResult(overrides: Partial<EndpointResult> = {}): EndpointResult {
    return {
        endpoint: ENDPOINT,
        result: { objects: [] } as never,
        elapsed: 100,
        candidates: 2,
        source: "network",
        timings: {},
        ...overrides,
    };
}

describe("applyEndpointResult", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("首次网络拉取:全字段取自响应,fetchedAt 为当前时间", () => {
        const { meta, entry } = applyEndpointResult(
            makeResult({
                etag: 'W/"1"',
                lastModified: "Mon, 01 Jan 2026 00:00:00 GMT",
                hash: "h1",
                size: 10,
                wireSize: 5,
                contentEncoding: "br",
            }),
            {},
            undefined,
        );
        expect(meta).toEqual({
            endpoint: ENDPOINT,
            fetchedAt: NOW,
            validatedAt: undefined,
            etag: 'W/"1"',
            lastModified: "Mon, 01 Jan 2026 00:00:00 GMT",
            hash: "h1",
            size: 10,
            wireSize: 5,
            contentEncoding: "br",
        });
        // 条目 = 元数据 + 内联索引体
        expect(entry.endpoint).toBe(ENDPOINT);
        expect(entry.result).toEqual({ objects: [] });
        expect(entry.etag).toBe('W/"1"');
    });

    it("同端点 304:etag/lastModified/统计字段沿用旧 meta,fetchedAt 沿用链上旧值", () => {
        const previous = {
            endpoint: ENDPOINT,
            fetchedAt: NOW - 2 * HOUR,
            etag: "old-etag",
            lastModified: "old-lm",
            hash: "old-hash",
            size: 99,
            wireSize: 50,
            contentEncoding: "gzip",
        };
        const { meta } = applyEndpointResult(
            makeResult({ source: "http-304", cachedAt: NOW - 2 * HOUR }),
            {},
            previous,
        );
        expect(meta.etag).toBe("old-etag");
        expect(meta.lastModified).toBe("old-lm");
        expect(meta.hash).toBe("old-hash");
        expect(meta.size).toBe(99);
        expect(meta.wireSize).toBe(50);
        expect(meta.contentEncoding).toBe("gzip");
        expect(meta.fetchedAt).toBe(NOW - 2 * HOUR);
    });

    it("换端点的 304 不沿用别的端点的条件元数据", () => {
        const previous = {
            endpoint: "https://b.example",
            fetchedAt: NOW - HOUR,
            etag: "old-etag",
            hash: "old-hash",
        };
        const { meta } = applyEndpointResult(makeResult({ source: "http-304" }), {}, previous);
        expect(meta.etag).toBeUndefined();
        expect(meta.lastModified).toBeUndefined();
        // fetchedAt 的兜底链不区分端点,仍沿用上一轮 meta 的时间戳
        expect(meta.fetchedAt).toBe(NOW - HOUR);
        // 链上完全没有旧值时才兜底当前时间
        const bare = applyEndpointResult(makeResult({ source: "http-304" }), {}, undefined);
        expect(bare.meta.fetchedAt).toBe(NOW);
    });

    it("非网络结果的 fetchedAt 沿用链:cachedAt 优先于条目旧值", () => {
        const cached = { endpoint: ENDPOINT, fetchedAt: NOW - 2 * HOUR };
        const fromEntry = applyEndpointResult(
            makeResult({ source: "disk-cache" }),
            { [ENDPOINT]: cached },
            undefined,
        );
        expect(fromEntry.meta.fetchedAt).toBe(NOW - 2 * HOUR);
        const fromCachedAt = applyEndpointResult(
            makeResult({ source: "disk-cache", cachedAt: NOW - 3 * HOUR }),
            { [ENDPOINT]: cached },
            undefined,
        );
        expect(fromCachedAt.meta.fetchedAt).toBe(NOW - 3 * HOUR);
    });

    it("hash 新值优先,响应缺失(304 不带 hash)时兜底旧值", () => {
        const previous = { endpoint: ENDPOINT, fetchedAt: NOW - HOUR, hash: "old-hash" };
        const kept = applyEndpointResult(
            makeResult({ source: "http-304", cachedAt: NOW }),
            {},
            previous,
        );
        expect(kept.meta.hash).toBe("old-hash");
        const replaced = applyEndpointResult(
            makeResult({ source: "network", hash: "new-hash" }),
            {},
            previous,
        );
        expect(replaced.meta.hash).toBe("new-hash");
    });
});

describe("buildConditionalHeaders", () => {
    it("命中条目时产出 etag/last-modified 条件头", () => {
        const headers = buildConditionalHeaders(
            { [ENDPOINT]: { endpoint: ENDPOINT, fetchedAt: 1, etag: "e1", lastModified: "lm1" } },
            undefined,
            ENDPOINT,
        );
        expect(headers).toEqual({ "if-none-match": "e1", "if-modified-since": "lm1" });
    });

    it("仅有 etag 时只带 if-none-match,空串视为无值", () => {
        const headers = buildConditionalHeaders(
            { [ENDPOINT]: { endpoint: ENDPOINT, fetchedAt: 1, etag: "" } },
            undefined,
            ENDPOINT,
        );
        expect(headers).toEqual({});
    });

    it("条目缺失时退回当前生效 meta,端点不一致则不给条件", () => {
        const meta = { endpoint: ENDPOINT, fetchedAt: 1, etag: "e2", lastModified: "lm2" };
        expect(buildConditionalHeaders({}, meta, ENDPOINT)).toEqual({
            "if-none-match": "e2",
            "if-modified-since": "lm2",
        });
        expect(buildConditionalHeaders({}, meta, "https://b.example")).toEqual({});
    });

    it("无条目无 meta 返回空对象", () => {
        expect(buildConditionalHeaders({}, undefined, ENDPOINT)).toEqual({});
    });
});
