/**
 * apply.ts 单测:applyMarketIndex(索引应用 + 版本计数)与
 * fetchAndApplyMarketIndex(竞速拉取 → 应用 → 落盘编排)。
 *
 * 策略:用最小 fixture 充当 MarketApplySource 结构性子集;竞速入口
 * fetchMarketIndex 用 vi.mock 替换为受控结果,buildMarketFetchDeps 保持
 * 真实执行;scope 用真实 RequestScope 验证序号新鲜度语义。
 */
import type { SearchResult } from "@koishi-ce/registry";
import { describe, expect, it, vi } from "vitest";
import { RequestScope } from "../../../racing/request-scope.js";
import { RouteStatsBook } from "../../../racing/stats.js";
import type { EndpointResult } from "../../types.js";
import { applyMarketIndex, fetchAndApplyMarketIndex } from "../apply.js";
import { fetchMarketIndex } from "../fetch-index.js";

vi.mock("../fetch-index.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../fetch-index.js")>();
	return { ...actual, fetchMarketIndex: vi.fn() };
});

const fetchMock = vi.mocked(fetchMarketIndex);

/** applyMarketIndex 所需的最小源视图(fixture,传参时再断言为接口类型)。 */
function makeApplySource() {
	return {
		endpoint: "https://old.example",
		scanner: {
			objects: [] as unknown[],
			total: 0,
			version: undefined as string | undefined,
			progress: 0,
		},
		counters: {
			dataVersion: 0,
			revision: 0,
			contentHash: undefined as string | undefined,
		},
		deps: { log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } },
	};
}

function makeIndex(objects: unknown[], version?: number | string) {
	return { objects, version } as unknown as SearchResult;
}

describe("applyMarketIndex", () => {
	it("objects 非数组时抛错拒绝应用", () => {
		const source = makeApplySource();
		expect(() =>
			applyMarketIndex(
				source as never,
				{ objects: null } as unknown as SearchResult,
				"https://a.example",
			),
		).toThrow("invalid market index from https://a.example");
		expect(source.scanner.total).toBe(0);
	});

	it("过滤 ignored 条目并更新 scanner 统计与当前端点", () => {
		const source = makeApplySource();
		applyMarketIndex(
			source as never,
			makeIndex(
				[
					{ package: { name: "kept" }, ignored: false },
					{ package: { name: "skipped" }, ignored: true },
				],
				123,
			),
			"https://a.example",
		);
		expect(source.endpoint).toBe("https://a.example");
		expect(source.scanner.objects).toHaveLength(1);
		expect(source.scanner.total).toBe(1);
		expect(source.scanner.version).toBe("123");
		// 应用日志带上 ignored/visible 统计,便于排查"为什么少了几个包"
		expect(source.deps.log.debug).toHaveBeenCalledWith(
			expect.stringContaining("ignored=1"),
		);
	});

	it("version 缺失时 scanner.version 保持 undefined", () => {
		const source = makeApplySource();
		applyMarketIndex(source as never, makeIndex([]), "https://a.example");
		expect(source.scanner.version).toBeUndefined();
	});

	it("dataVersion 仅在 hash 缺失或变化时递增,revision 每次 apply 都递增", () => {
		const source = makeApplySource();
		const result = makeIndex([]);
		applyMarketIndex(source as never, result, "https://a.example", undefined);
		expect(source.counters.dataVersion).toBe(1);
		applyMarketIndex(source as never, result, "https://a.example", undefined);
		expect(source.counters.dataVersion).toBe(2);
		applyMarketIndex(source as never, result, "https://a.example", "h1");
		expect(source.counters.dataVersion).toBe(3);
		// 同 hash 重复应用:数据没变,dataVersion 不动,revision 照常递增
		applyMarketIndex(source as never, result, "https://a.example", "h1");
		expect(source.counters.dataVersion).toBe(3);
		applyMarketIndex(source as never, result, "https://a.example", "h2");
		expect(source.counters.dataVersion).toBe(4);
		expect(source.counters.revision).toBe(5);
		expect(source.counters.contentHash).toBe("h2");
	});
});

/** fetchAndApplyMarketIndex 所需的最小源视图(竞速依赖保持真实组装)。 */
function makeFetchSource(overrides: Record<string, unknown> = {}) {
	const scope = new RequestScope();
	const stats = new RouteStatsBook({
		fastThreshold: 500,
		successClamp: [-4, 3] as const,
		failureClamp: [-4, 3] as const,
		failurePenalty: () => 1,
		cooldown: () => 0,
		roundAverage: false,
		trackFailureMeta: false,
	});
	const config = { endpoint: "https://primary.example" };
	const cache = {
		entries: {},
		loadEntryResult: vi.fn(),
		conditionalHeaders: vi.fn(() => ({})),
		updateState: vi.fn(),
		scheduleWrite: vi.fn(),
		meta: { endpoint: "https://a.example", fetchedAt: 1 },
	};
	const source = {
		scope,
		stats,
		config,
		endpoint: "",
		scoreContext: () => ({ config, stats, cacheEntries: {} }),
		cache,
		scanner: { objects: [] as unknown[], total: 5, version: "1", progress: 1 },
		counters: {
			dataVersion: 0,
			revision: 0,
			contentHash: undefined as string | undefined,
		},
		deps: { log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } },
		cacheMetaPresent: true,
		collectError: new Error("previous failure") as unknown,
		payloadValue: { total: 1, failed: 0, progress: 1 } as unknown,
		applyIndex: vi.fn(),
		updateDebugInfo: vi.fn(),
		warmDiskCacheTask: undefined as Promise<boolean> | undefined,
		notifyRefresh: vi.fn(),
	};
	return Object.assign(source, overrides);
}

function makeEndpointResult(sourceKind: string): EndpointResult {
	return {
		endpoint: "https://winner.example",
		result: { objects: [] } as never,
		elapsed: 120,
		candidates: 3,
		source: sourceKind as EndpointResult["source"],
		timings: {},
		hash: "h1",
	};
}

describe("fetchAndApplyMarketIndex", () => {
	it("网络胜出:应用 → 更新缓存 → 落盘 → 清缓存标记并记录耗时", async () => {
		const source = makeFetchSource();
		const result = makeEndpointResult("network");
		fetchMock.mockResolvedValueOnce(result);

		const applied = await fetchAndApplyMarketIndex(
			source as never,
			source.scope.current,
			"refresh",
		);

		expect(applied).toBe(result);
		expect(source.applyIndex).toHaveBeenCalledWith(
			result.result,
			result.endpoint,
			"h1",
		);
		expect(source.cache.updateState).toHaveBeenCalledWith(result);
		expect(source.cache.scheduleWrite).toHaveBeenCalledWith(
			result.result,
			source.cache.meta,
		);
		expect(source.cacheMetaPresent).toBe(false);
		expect(source.collectError).toBeUndefined();
		// refresh 阶段清掉旧快照载荷,强制下次 getSnapshot 重建
		expect(source.payloadValue).toBeUndefined();
		expect(source.updateDebugInfo).toHaveBeenCalledWith(
			expect.objectContaining({ source: "network" }),
			"refresh",
		);
		expect(result.timings["apply"]).toBeTypeOf("number");
		expect(result.timings["total"]).toBeTypeOf("number");
	});

	it("disk-cache 来源数据本就来自缓存,不再写回磁盘", async () => {
		const source = makeFetchSource();
		const result = makeEndpointResult("disk-cache");
		fetchMock.mockResolvedValueOnce(result);

		const applied = await fetchAndApplyMarketIndex(
			source as never,
			source.scope.current,
			"initial",
		);

		expect(applied).toBe(result);
		expect(source.cache.scheduleWrite).not.toHaveBeenCalled();
		// initial 阶段保留旧载荷
		expect(source.payloadValue).toEqual({ total: 1, failed: 0, progress: 1 });
	});

	it("竞速期间序号被推进:结果作废,不应用不落盘", async () => {
		const source = makeFetchSource();
		const staleSerial = source.scope.current;
		source.scope.advance("superseded");
		fetchMock.mockResolvedValueOnce(makeEndpointResult("network"));

		const applied = await fetchAndApplyMarketIndex(
			source as never,
			staleSerial,
			"refresh",
		);

		expect(applied).toBeUndefined();
		expect(source.applyIndex).not.toHaveBeenCalled();
		expect(source.cache.updateState).not.toHaveBeenCalled();
		expect(source.cache.scheduleWrite).not.toHaveBeenCalled();
	});
});
