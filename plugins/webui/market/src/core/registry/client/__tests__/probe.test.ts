/**
 * probe.ts 单测:RouteProbe 的单飞探测(ensure)、结果落地(apply)、
 * 失败告警与过期(serial stale)防护、reset 重置。
 */
import { describe, expect, it, vi } from "vitest";
import type { RaceAttempt } from "../../../racing/race.js";
import { RouteProbe, type RouteProbeDeps } from "../probe.js";
import { makeRegistryPayload, makeScope, type RecordingLog } from "./helpers.js";

const ENDPOINTS = ["https://primary", "https://mirror-a", "https://mirror-b"];

/** 构造 RouteProbe 与可断言的依赖面。 */
function makeProbe() {
    const log = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    } satisfies RecordingLog;
    const scope = makeScope();
    const scoresSummary = vi.fn(() => "scores");
    const deps: RouteProbeDeps = { scope, log, scoresSummary };
    return { probe: new RouteProbe(deps), scope, log, scoresSummary };
}

/** 构造一次成功竞速的 RaceAttempt。 */
function attemptOf(overrides: Partial<RaceAttempt<ReturnType<typeof makeRegistryPayload>>> = {}) {
    return {
        endpoint: ENDPOINTS[0]!,
        payload: makeRegistryPayload(),
        elapsed: 42,
        ...overrides,
    };
}

describe("RouteProbe.ensure", () => {
    it("无探针包名时跳过探测", async () => {
        const { probe } = makeProbe();
        const fetchByRoute = vi.fn();
        await probe.ensure("", ENDPOINTS, 0, fetchByRoute);
        expect(probe.task).toBeUndefined();
        expect(fetchByRoute).not.toHaveBeenCalled();
    });

    it("候选端点不足两个时跳过探测", async () => {
        const { probe } = makeProbe();
        const fetchByRoute = vi.fn();
        await probe.ensure("pkg", ["https://only"], 0, fetchByRoute);
        expect(probe.task).toBeUndefined();
        expect(fetchByRoute).not.toHaveBeenCalled();
    });

    it("探测成功:主端点胜出时记录结果并输出 primary 日志", async () => {
        const { probe, log, scoresSummary } = makeProbe();
        const fetchByRoute = vi.fn(async () => attemptOf());
        await probe.ensure("pkg", ENDPOINTS, 0, fetchByRoute);
        expect(probe.result).toMatchObject({
            serial: 0,
            name: "pkg",
            endpoint: "https://primary",
            elapsed: 42,
        });
        expect(log.info).toHaveBeenCalledWith(expect.stringContaining("primary selected"));
        expect(log.debug).toHaveBeenCalledWith(expect.stringContaining("route scores"));
        expect(scoresSummary).toHaveBeenCalled();
    });

    it("探测成功:镜像胜出时输出 fallback 日志并记录原因", async () => {
        const { probe, log } = makeProbe();
        const fetchByRoute = vi.fn(async () =>
            attemptOf({ endpoint: "https://mirror-a", fallbackReason: "primary-failed" }),
        );
        await probe.ensure("pkg", ENDPOINTS, 0, fetchByRoute);
        expect(probe.result?.fallbackReason).toBe("primary-failed");
        expect(log.info).toHaveBeenCalledWith(expect.stringContaining("fallback selected"));
    });

    it("单飞去重:并发 ensure 共享同一次探测", async () => {
        const { probe } = makeProbe();
        let release: (() => void) | undefined;
        const fetchByRoute = vi.fn(
            () =>
                new Promise<RaceAttempt<ReturnType<typeof makeRegistryPayload>>>((resolve) => {
                    release = () => resolve(attemptOf());
                }),
        );
        const first = probe.ensure("pkg", ENDPOINTS, 0, fetchByRoute);
        const second = probe.ensure("pkg", ENDPOINTS, 0, fetchByRoute);
        release!();
        await Promise.all([first, second]);
        expect(fetchByRoute).toHaveBeenCalledTimes(1);
    });

    it("探测失败:仅告警不抛出、不落结果", async () => {
        const { probe, log } = makeProbe();
        const fetchByRoute = vi.fn(async () => {
            throw new Error("fetch failed");
        });
        await expect(probe.ensure("pkg", ENDPOINTS, 0, fetchByRoute)).resolves.toBeUndefined();
        expect(probe.result).toBeUndefined();
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("route probe failed"));
    });

    it("探测成功但请求已过期:结果不落地", async () => {
        const { probe, scope, log } = makeProbe();
        const fetchByRoute = vi.fn(async () => {
            scope.advance("new round");
            return attemptOf();
        });
        await probe.ensure("pkg", ENDPOINTS, 0, fetchByRoute);
        expect(probe.result).toBeUndefined();
        expect(log.info).not.toHaveBeenCalledWith(expect.stringContaining("selected"));
    });

    it("探测失败且请求已过期:不告警", async () => {
        const { probe, scope, log } = makeProbe();
        const fetchByRoute = vi.fn(async () => {
            scope.advance("new round");
            throw new Error("fetch failed");
        });
        await probe.ensure("pkg", ENDPOINTS, 0, fetchByRoute);
        expect(log.warn).not.toHaveBeenCalled();
    });
});

describe("RouteProbe.reset", () => {
    it("清空任务与结果,下次 ensure 重新探测", async () => {
        const { probe } = makeProbe();
        const fetchByRoute = vi.fn(async () => attemptOf());
        await probe.ensure("pkg", ENDPOINTS, 0, fetchByRoute);
        expect(probe.result).toBeDefined();

        probe.reset();
        expect(probe.task).toBeUndefined();
        expect(probe.result).toBeUndefined();

        await probe.ensure("pkg", ENDPOINTS, 0, fetchByRoute);
        expect(fetchByRoute).toHaveBeenCalledTimes(2);
        expect(probe.result?.serial).toBe(0);
    });
});
