import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { raceEndpoints } from "../race.js";
import { RequestScope } from "../request-scope.js";

type RaceResult = { payload: string; elapsed: number };

function makeFetch(results: Record<string, RaceResult | Error>) {
    return vi.fn((endpoint: string, _signal: AbortSignal): Promise<RaceResult> => {
        const value = results[endpoint]!;
        if (value instanceof Error) return Promise.reject(value);
        return Promise.resolve(value);
    });
}

describe("raceEndpoints 单端点", () => {
    it("成功结算并回调 onSuccess", async () => {
        const scope = new RequestScope();
        const fetch = makeFetch({ a: { payload: "p", elapsed: 10 } });
        const onSuccess = vi.fn();
        const result = await raceEndpoints({
            endpoints: ["a"],
            stagger: 0,
            slowThreshold: 1000,
            scope,
            serial: scope.current,
            fetch,
            onSuccess,
            onFailure: vi.fn(),
        });
        expect(result).toEqual({ endpoint: "a", payload: "p", elapsed: 10 });
        expect(onSuccess).toHaveBeenCalledWith(result);
    });

    it("失败时回调 onFailure 并抛出错误", async () => {
        const scope = new RequestScope();
        const error = new Error("boom");
        const fetch = makeFetch({ a: error });
        const onFailure = vi.fn();
        await expect(
            raceEndpoints({
                endpoints: ["a"],
                stagger: 0,
                slowThreshold: 1000,
                scope,
                serial: scope.current,
                fetch,
                onSuccess: vi.fn(),
                onFailure,
            }),
        ).rejects.toBe(error);
        expect(onFailure).toHaveBeenCalledWith("a", error);
    });

    it("serial 过期时不回调 onFailure", async () => {
        const scope = new RequestScope();
        const error = new Error("boom");
        const fetch = makeFetch({ a: error });
        const onFailure = vi.fn();
        const promise = raceEndpoints({
            endpoints: ["a"],
            stagger: 0,
            slowThreshold: 1000,
            scope,
            serial: scope.current,
            fetch,
            onSuccess: vi.fn(),
            onFailure,
        });
        scope.advance("superseded");
        await expect(promise).rejects.toBe(error);
        expect(onFailure).not.toHaveBeenCalled();
    });
});

describe("raceEndpoints 多端点", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("主端点慢于阈值时以 primary-slow 启动 fallback 并胜出", async () => {
        const scope = new RequestScope();
        const fetch = vi.fn((endpoint: string, _signal: AbortSignal) => {
            if (endpoint === "primary") return new Promise<RaceResult>(() => {});
            return Promise.resolve({ payload: endpoint, elapsed: 100 } satisfies RaceResult);
        });
        const onSuccess = vi.fn();
        const promise = raceEndpoints({
            endpoints: ["primary", "fallback"],
            stagger: 50,
            slowThreshold: 1000,
            scope,
            serial: scope.current,
            fetch,
            onSuccess,
            onFailure: vi.fn(),
        });
        await vi.advanceTimersByTimeAsync(1000);
        const result = await promise;
        expect(result).toMatchObject({
            endpoint: "fallback",
            payload: "fallback",
            fallbackReason: "primary-slow",
        });
        expect(onSuccess).toHaveBeenCalledWith(result);
    });

    it("主端点失败时以 primary-failed 启动 fallback", async () => {
        const scope = new RequestScope();
        const error = new Error("boom");
        const fetch = vi.fn((endpoint: string, _signal: AbortSignal) => {
            if (endpoint === "primary") return Promise.reject(error);
            return Promise.resolve({ payload: endpoint, elapsed: 50 } satisfies RaceResult);
        });
        const onFailure = vi.fn();
        const result = await raceEndpoints({
            endpoints: ["primary", "fallback"],
            stagger: 50,
            slowThreshold: 1000,
            scope,
            serial: scope.current,
            fetch,
            onSuccess: vi.fn(),
            onFailure,
        });
        expect(result).toMatchObject({
            endpoint: "fallback",
            payload: "fallback",
            fallbackReason: "primary-failed",
        });
        expect(onFailure).toHaveBeenCalledWith("primary", error);
    });

    it("全部端点失败时抛出最后一个错误并逐个回调 onFailure", async () => {
        const scope = new RequestScope();
        const error = new Error("boom");
        const fetch = vi.fn(
            (_endpoint: string, _signal: AbortSignal): Promise<RaceResult> => Promise.reject(error),
        );
        const onFailure = vi.fn();
        const promise = raceEndpoints({
            endpoints: ["a", "b", "c"],
            stagger: 0,
            slowThreshold: 500,
            scope,
            serial: scope.current,
            fetch,
            onSuccess: vi.fn(),
            onFailure,
        });
        const assertion = expect(promise).rejects.toBe(error);
        await vi.advanceTimersByTimeAsync(0);
        await assertion;
        expect(onFailure).toHaveBeenCalledTimes(3);
    });

    it("结算后中止其余请求", async () => {
        const scope = new RequestScope();
        let primarySignal: AbortSignal | undefined;
        const fetch = vi.fn((endpoint: string, signal: AbortSignal) => {
            if (endpoint === "primary") {
                primarySignal = signal;
                return new Promise<RaceResult>(() => {});
            }
            return Promise.resolve({ payload: endpoint, elapsed: 50 } satisfies RaceResult);
        });
        const promise = raceEndpoints({
            endpoints: ["primary", "fallback"],
            stagger: 0,
            slowThreshold: 1000,
            scope,
            serial: scope.current,
            fetch,
            onSuccess: vi.fn(),
            onFailure: vi.fn(),
        });
        await vi.advanceTimersByTimeAsync(1000);
        const result = await promise;
        expect(result.endpoint).toBe("fallback");
        expect(primarySignal!.aborted).toBe(true);
        expect(primarySignal!.reason).toBeInstanceOf(Error);
    });

    it("错峰：fallback 按 stagger 依次延迟发起", async () => {
        const scope = new RequestScope();
        const startedAt: number[] = [];
        const fetch = vi.fn((endpoint: string, _signal: AbortSignal) => {
            if (endpoint === "primary") return new Promise<RaceResult>(() => {});
            startedAt.push(Date.now());
            if (endpoint === "fb1") return new Promise<RaceResult>(() => {});
            return Promise.resolve({ payload: endpoint, elapsed: 10 } satisfies RaceResult);
        });
        const promise = raceEndpoints({
            endpoints: ["primary", "fb1", "fb2"],
            stagger: 100,
            slowThreshold: 1000,
            scope,
            serial: scope.current,
            fetch,
            onSuccess: vi.fn(),
            onFailure: vi.fn(),
        });
        await vi.advanceTimersByTimeAsync(1000); // slow → fallback 开始
        // fb1 立即发起，fb2 延迟 100ms；fb2 胜出
        await vi.advanceTimersByTimeAsync(100);
        const result = await promise;
        expect(result.endpoint).toBe("fb2");
        expect(startedAt).toHaveLength(2);
        expect(startedAt[1]! - startedAt[0]!).toBe(100);
    });
});
