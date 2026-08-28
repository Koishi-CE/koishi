/**
 * refresh.ts 单测:startMarketIndex(手动/自动刷新入口的后台复用、
 * 缓存回放先上屏、collect 兜底与序号守卫)与 scheduleRefreshAfterPrepareTask
 * (预备任务刷新登记的去重与顶替)。
 *
 * 策略:最小 fixture 充当结构性子集源;scope 用真实 RequestScope,
 * applyDiskCache/flushMarketPatch/clearRouteCooldowns 保持真实执行
 * (cache.load/collect 等副作用以 vi.fn 受控)。
 */
import { describe, expect, it, vi } from "vitest";
import { RequestScope } from "../../../racing/request-scope.js";
import { RouteStatsBook } from "../../../racing/stats.js";
import { scheduleRefreshAfterPrepareTask, startMarketIndex } from "../refresh.js";

function makeStats() {
    return new RouteStatsBook({
        fastThreshold: 500,
        successClamp: [-4, 3] as const,
        failureClamp: [-4, 3] as const,
        failurePenalty: () => 1,
        cooldown: () => 0,
        roundAverage: false,
        trackFailureMeta: false,
    });
}

/** startMarketIndex 所需的最小源视图(fixture,传参时再断言为接口类型)。 */
function makeSource(overrides: Record<string, unknown> = {}) {
    const scope = new RequestScope();
    const notifyRefresh = vi.fn();
    const source = {
        scope,
        stats: makeStats(),
        background: { refreshInBackground: vi.fn(() => true) },
        backgroundTask: undefined as Promise<void> | undefined,
        backgroundSerial: undefined as number | undefined,
        collectTask: undefined as Promise<undefined> | undefined,
        collectError: undefined as unknown,
        forceRefresh: true,
        hasCurrentData: vi.fn(() => false),
        collect: vi.fn(async () => undefined),
        cache: {
            load: vi.fn(async () => ({
                store: { version: 3, entries: {} },
                applied: undefined,
                shouldMigrate: false,
            })),
        },
        scanner: { objects: [] as unknown[], total: 0, progress: 0, version: undefined },
        warmDiskCacheTask: undefined as Promise<boolean> | undefined,
        cacheMetaPresent: false,
        applyIndex: vi.fn(),
        updateDebugInfo: vi.fn(),
        notifyRefresh,
        failed: [] as string[],
        fullCache: {},
        tempCache: {},
        debugInfoValue: undefined,
        revisionValue: 0,
        nextRevision: vi.fn(() => 1),
        deps: { notifyRefresh, onRegistryVersions: vi.fn(), broadcastPatch: vi.fn() },
        log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
        fetchAndApply: vi.fn(),
        resetProbeState: vi.fn(),
    };
    return Object.assign(source, overrides);
}

describe("startMarketIndex", () => {
    it("非手动刷新:推进序号后走完整 collect,结束广播刷新", async () => {
        const source = makeSource();
        await startMarketIndex(source as never, false);
        expect(source.scope.current).toBe(1);
        expect(source.forceRefresh).toBe(false);
        expect(source.collect).toHaveBeenCalledTimes(1);
        expect(source.deps.notifyRefresh).toHaveBeenCalledTimes(1);
    });

    it("手动刷新且已有数据:直接上屏通知,不推进 collect 与后台刷新", async () => {
        const source = makeSource({ hasCurrentData: vi.fn(() => true) });
        await startMarketIndex(source as never, true);
        expect(source.scope.current).toBe(1);
        expect(source.collect).not.toHaveBeenCalled();
        expect(source.background.refreshInBackground).not.toHaveBeenCalled();
        expect(source.deps.notifyRefresh).toHaveBeenCalledTimes(1);
    });

    it("手动刷新无数据但缓存回放成功:应用缓存后交给后台 soft refresh", async () => {
        const source = makeSource({
            cache: {
                load: vi.fn(async () => ({
                    store: { version: 3, entries: {} },
                    applied: {
                        endpoint: "https://a.example",
                        result: { objects: [] },
                        hash: "h",
                        fetchedAt: 1,
                    },
                    shouldMigrate: false,
                })),
            },
        });
        await startMarketIndex(source as never, true);
        expect(source.applyIndex).toHaveBeenCalledWith({ objects: [] }, "https://a.example", "h");
        expect(source.cacheMetaPresent).toBe(true);
        expect(source.background.refreshInBackground).toHaveBeenCalledWith(1, "soft refresh");
        expect(source.collect).not.toHaveBeenCalled();
        expect(source.deps.notifyRefresh).toHaveBeenCalledTimes(1);
    });

    it("手动刷新且缓存也无:回放失败后回落完整 collect", async () => {
        const source = makeSource();
        await startMarketIndex(source as never, true);
        expect(source.cache.load).toHaveBeenCalledTimes(1);
        expect(source.applyIndex).not.toHaveBeenCalled();
        expect(source.collect).toHaveBeenCalledTimes(1);
        expect(source.deps.notifyRefresh).toHaveBeenCalledTimes(1);
    });

    it("同 serial 后台任务在跑:复用序号,不推进不重拉", async () => {
        const source = makeSource({
            backgroundTask: Promise.resolve(),
            backgroundSerial: 0,
            hasCurrentData: vi.fn(() => true),
        });
        await startMarketIndex(source as never, true);
        expect(source.scope.current).toBe(0);
        expect(source.collect).not.toHaveBeenCalled();
        expect(source.deps.notifyRefresh).toHaveBeenCalledTimes(1);
    });

    it("collect 期间序号被推进:结果过期,不通知前端", async () => {
        const scope = new RequestScope();
        const source = makeSource({
            scope,
            collect: vi.fn(async () => {
                scope.advance("superseded");
            }),
        });
        await startMarketIndex(source as never, false);
        expect(source.collect).toHaveBeenCalledTimes(1);
        expect(source.deps.notifyRefresh).not.toHaveBeenCalled();
    });
});

/** 预备任务登记所需的最小源视图(接口仅两成员,字面量直接满足)。 */
function makePendingSource() {
    return {
        pendingRefreshTask: undefined as Promise<unknown> | undefined,
        deps: { notifyRefresh: vi.fn() },
    };
}

/** 等待 finally 回调微任务跑完。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("scheduleRefreshAfterPrepareTask", () => {
    it("登记后任务完成:清空登记并通知前端刷新", async () => {
        const source = makePendingSource();
        let release!: () => void;
        const task = new Promise<void>((resolve) => {
            release = resolve;
        });
        scheduleRefreshAfterPrepareTask(source, task);
        expect(source.pendingRefreshTask).toBe(task);
        release();
        await task;
        await settle();
        expect(source.pendingRefreshTask).toBeUndefined();
        expect(source.deps.notifyRefresh).toHaveBeenCalledTimes(1);
    });

    it("同一任务重复登记直接忽略,完成后仍只通知一次", async () => {
        const source = makePendingSource();
        const task = Promise.resolve();
        scheduleRefreshAfterPrepareTask(source, task);
        scheduleRefreshAfterPrepareTask(source, task);
        expect(source.pendingRefreshTask).toBe(task);
        await task;
        await settle();
        expect(source.pendingRefreshTask).toBeUndefined();
        expect(source.deps.notifyRefresh).toHaveBeenCalledTimes(1);
    });

    it("任务被顶替后完成:不清空新登记,但自身仍触发通知", async () => {
        const source = makePendingSource();
        let releaseA!: () => void;
        const taskA = new Promise<void>((resolve) => {
            releaseA = resolve;
        });
        // taskB 故意不结算,验证 taskA 的 finally 不清别人的登记
        const taskB = new Promise<void>(() => {});
        scheduleRefreshAfterPrepareTask(source, taskA);
        scheduleRefreshAfterPrepareTask(source, taskB);
        expect(source.pendingRefreshTask).toBe(taskB);
        releaseA();
        await taskA;
        await settle();
        expect(source.pendingRefreshTask).toBe(taskB);
        expect(source.deps.notifyRefresh).toHaveBeenCalledTimes(1);
    });
});
