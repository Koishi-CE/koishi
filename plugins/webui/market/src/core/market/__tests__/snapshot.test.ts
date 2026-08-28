import { describe, expect, it, vi } from "vitest";
import { buildMarketSnapshot, type SnapshotHost } from "../snapshot.js";

function makeHost(overrides: Partial<SnapshotHost> = {}): SnapshotHost {
    return {
        hasCurrentData: () => false,
        isModern: () => true,
        endpointLabel: () => "https://endpoint",
        fallbackEndpointLabel: () => "https://fallback",
        dataVersion: 1,
        backgroundRunning: () => false,
        backgroundTask: () => undefined,
        warmCacheTask: () => undefined,
        warmCache: async () => false,
        prepareTask: () => Promise.resolve(undefined),
        scheduleRefreshAfterPrepare: () => {},
        buildData: () => ({}),
        buildPayload: () => ({ total: 0, failed: 0, progress: 0 }),
        failedCount: () => 0,
        scannerTotal: () => 0,
        scannerProgress: () => 0,
        payload: () => undefined,
        setPayload: () => {},
        error: () => undefined,
        debugInfo: () => undefined,
        log: { debug: () => {}, info: () => {}, warn: () => {} },
        ...overrides,
    };
}

describe("buildMarketSnapshot", () => {
    it("后台运行 + 已有数据 + modern → 直接返回 buildPayload", async () => {
        const payload = { total: 3, failed: 0, progress: 1 };
        const host = makeHost({
            backgroundRunning: () => true,
            hasCurrentData: () => true,
            isModern: () => true,
            buildPayload: () => payload,
        });
        await expect(buildMarketSnapshot(host)).resolves.toBe(payload);
    });

    it("后台运行 + 已有数据 + legacy → 返回 refreshing 快照", async () => {
        const host = makeHost({
            backgroundRunning: () => true,
            hasCurrentData: () => true,
            isModern: () => false,
            payload: () => ({ total: 5, failed: 2, progress: 4 }),
            dataVersion: 7,
        });
        const result = await buildMarketSnapshot(host);
        expect(result).toMatchObject({
            total: 5,
            failed: 2,
            progress: 4,
            stale: false,
            error: undefined,
            refreshing: true,
            loading: false,
            dataVersion: 7,
        });
        expect(result.serverNow).toBeTypeOf("number");
    });

    it("已有 payload 且无错误 → 原样返回并附 dataVersion/debug", async () => {
        const host = makeHost({
            hasCurrentData: () => true,
            payload: () => ({ total: 5, failed: 0, progress: 5 }),
            dataVersion: 3,
        });
        const result = await buildMarketSnapshot(host);
        expect(result).toMatchObject({ total: 5, dataVersion: 3 });
        expect(result.serverNow).toBeTypeOf("number");
    });

    it("预热任务完成且出现数据 → 返回 buildPayload", async () => {
        let hasData = false;
        const warmTask = Promise.resolve().then(() => {
            hasData = true;
            return true;
        });
        const host = makeHost({
            hasCurrentData: () => hasData,
            warmCacheTask: () => warmTask,
            buildPayload: () => ({ total: 9, failed: 0, progress: 9 }),
        });
        await expect(buildMarketSnapshot(host)).resolves.toEqual({
            total: 9,
            failed: 0,
            progress: 9,
        });
    });

    it("无预热任务时调用 warmCache 拉取", async () => {
        let hasData = false;
        const host = makeHost({
            hasCurrentData: () => hasData,
            warmCache: vi.fn(async () => {
                hasData = true;
                return true;
            }),
            buildPayload: () => ({ total: 4, failed: 0, progress: 4 }),
        });
        await expect(buildMarketSnapshot(host)).resolves.toEqual({
            total: 4,
            failed: 0,
            progress: 4,
        });
        expect(host.warmCache).toHaveBeenCalledWith("first get");
    });

    it("首载超时 → 返回 loading 快照并调度后续刷新", async () => {
        vi.useFakeTimers();
        try {
            const host = makeHost({
                scheduleRefreshAfterPrepare: vi.fn(),
                prepareTask: () => new Promise<never>(() => {}), // 永不 resolve
            });
            const promise = buildMarketSnapshot(host);
            await vi.advanceTimersByTimeAsync(1500);
            const result = await promise;
            expect(host.scheduleRefreshAfterPrepare).toHaveBeenCalled();
            expect(result).toMatchObject({
                registry: "https://fallback",
                total: 0,
                failed: 0,
                progress: 0,
                stale: false,
                error: undefined,
                refreshing: true,
                loading: true,
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it("prepare 任务完成后出现数据 → 返回 buildPayload", async () => {
        let hasData = false;
        const host = makeHost({
            hasCurrentData: () => hasData,
            prepareTask: () =>
                Promise.resolve().then(() => {
                    hasData = true;
                    return undefined;
                }),
            buildPayload: () => ({ total: 2, failed: 0, progress: 2 }),
        });
        await expect(buildMarketSnapshot(host)).resolves.toEqual({
            total: 2,
            failed: 0,
            progress: 2,
        });
    });

    it("有错误且有缓存 payload → 返回 stale 旧快照", async () => {
        const host = makeHost({
            prepareTask: () => Promise.resolve(undefined),
            error: () => new Error("boom"),
            payload: () => ({ total: 6, failed: 0, progress: 6 }),
            dataVersion: 2,
        });
        const result = await buildMarketSnapshot(host);
        expect(result).toMatchObject({
            total: 6,
            stale: true,
            error: "boom",
            refreshing: false,
            loading: false,
            dataVersion: 2,
        });
    });

    it("有错误且无缓存 payload → 返回 error 快照", async () => {
        const host = makeHost({
            prepareTask: () => Promise.resolve(undefined),
            error: () => new Error("boom"),
        });
        const result = await buildMarketSnapshot(host);
        expect(result).toMatchObject({
            error: "boom",
            refreshing: false,
            loading: false,
            total: 0,
        });
    });
});
