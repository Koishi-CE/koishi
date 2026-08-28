/**
 * route-fetch.ts 单测:多端点竞速拉取(fetchRegistryByRoute)的成功/失败/
 * 404 不惩罚/坏负载/过期防护,以及全军覆没时的失败归因挂载。
 */
import { describe, expect, it, vi } from "vitest";
import { fetchRegistryByRoute } from "../route-fetch.js";
import {
    type HttpHandler,
    httpError,
    makeHttpFactory,
    makeRegistryPayload,
    makeRouteDeps,
    PRIMARY_ENDPOINT,
} from "./helpers.js";

const MIRROR = "https://mirror.example.com";

describe("fetchRegistryByRoute", () => {
    it("单端点成功:返回负载、记成功、上报尝试次数", async () => {
        const get = vi.fn(async () => makeRegistryPayload()) as unknown as HttpHandler;
        const deps = makeRouteDeps({ httpFactory: makeHttpFactory({ [PRIMARY_ENDPOINT]: get }) });
        const onAttempt = vi.fn();
        const result = await fetchRegistryByRoute(
            deps,
            "pkg",
            [PRIMARY_ENDPOINT],
            deps.scope.current,
            onAttempt,
        );
        expect(result.endpoint).toBe(PRIMARY_ENDPOINT);
        expect(result.payload.versions).toHaveProperty("1.0.0");
        expect(result.elapsed).toBeGreaterThanOrEqual(0);
        expect(deps.recordRouteSuccess).toHaveBeenCalledWith(
            expect.objectContaining({ endpoint: PRIMARY_ENDPOINT }),
        );
        expect(deps.recordRouteFailure).not.toHaveBeenCalled();
        expect(onAttempt).toHaveBeenCalledWith(PRIMARY_ENDPOINT, 1);
        // 请求路径为 /<name>,且竞速通道总是携带 AbortSignal
        expect(get).toHaveBeenCalledWith(
            "/pkg",
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
        // 慢端点阈值取主端点的降级延迟
        expect(deps.getFallbackDelay).toHaveBeenCalledWith(PRIMARY_ENDPOINT);
    });

    it("单端点网络失败:抛错、按 network 惩罚、归因挂到异常", async () => {
        const error = new Error("fetch failed");
        const deps = makeRouteDeps({
            httpFactory: makeHttpFactory({ [PRIMARY_ENDPOINT]: error }),
        });
        await expect(
            fetchRegistryByRoute(deps, "pkg", [PRIMARY_ENDPOINT], deps.scope.current),
        ).rejects.toThrow("fetch failed");
        expect(deps.recordRouteFailure).toHaveBeenCalledWith(PRIMARY_ENDPOINT, "network");
        const attached = (error as { marketNextReasons?: string[] }).marketNextReasons;
        expect(attached).toEqual(["network"]);
    });

    it("单端点 404:not-found 不惩罚端点评分", async () => {
        const error = httpError(404);
        const deps = makeRouteDeps({
            httpFactory: makeHttpFactory({ [PRIMARY_ENDPOINT]: error }),
        });
        await expect(
            fetchRegistryByRoute(deps, "pkg", [PRIMARY_ENDPOINT], deps.scope.current),
        ).rejects.toThrow();
        expect(deps.recordRouteFailure).not.toHaveBeenCalled();
        expect((error as { marketNextReasons?: string[] }).marketNextReasons).toEqual([
            "not-found",
        ]);
    });

    it("返回负载缺少 versions 对象时视为 invalid 并惩罚", async () => {
        const bad = { versions: "not-an-object" } as unknown as ReturnType<
            typeof makeRegistryPayload
        >;
        const deps = makeRouteDeps({
            httpFactory: makeHttpFactory({ [PRIMARY_ENDPOINT]: bad }),
        });
        await expect(
            fetchRegistryByRoute(deps, "pkg", [PRIMARY_ENDPOINT], deps.scope.current),
        ).rejects.toThrow("invalid registry metadata for pkg");
        expect(deps.recordRouteFailure).toHaveBeenCalledWith(PRIMARY_ENDPOINT, "invalid");
    });

    it("返回 undefined 负载同样按 invalid 处理", async () => {
        const deps = makeRouteDeps({
            httpFactory: makeHttpFactory({
                [PRIMARY_ENDPOINT]: (async () => undefined) as unknown as HttpHandler,
            }),
        });
        await expect(
            fetchRegistryByRoute(deps, "pkg", [PRIMARY_ENDPOINT], deps.scope.current),
        ).rejects.toThrow("invalid registry metadata for pkg");
    });

    it("请求过期(竞速域失效):终止且不计失败", async () => {
        const deps = makeRouteDeps({
            httpFactory: makeHttpFactory({
                [PRIMARY_ENDPOINT]: async () => {
                    deps.scope.advance("new round");
                    return makeRegistryPayload();
                },
            }),
        });
        await expect(
            fetchRegistryByRoute(deps, "pkg", [PRIMARY_ENDPOINT], deps.scope.current),
        ).rejects.toThrow("npm registry route probe stale");
        expect(deps.recordRouteFailure).not.toHaveBeenCalled();
        expect(deps.recordRouteSuccess).not.toHaveBeenCalled();
    });

    it("主端点失败后镜像胜出:fallbackReason=primary-failed 且两端点分别记成败", async () => {
        const deps = makeRouteDeps({
            httpFactory: makeHttpFactory({
                [PRIMARY_ENDPOINT]: new Error("fetch failed"),
                [MIRROR]: makeRegistryPayload(),
            }),
        });
        const onAttempt = vi.fn();
        const result = await fetchRegistryByRoute(
            deps,
            "pkg",
            [PRIMARY_ENDPOINT, MIRROR],
            deps.scope.current,
            onAttempt,
        );
        expect(result.endpoint).toBe(MIRROR);
        expect(result.fallbackReason).toBe("primary-failed");
        expect(deps.recordRouteFailure).toHaveBeenCalledWith(PRIMARY_ENDPOINT, "network");
        expect(deps.recordRouteSuccess).toHaveBeenCalledWith(
            expect.objectContaining({ endpoint: MIRROR }),
        );
        expect(onAttempt).toHaveBeenCalledTimes(2);
    });

    it("全部端点失败:抛最后错误并聚合各端点归因(404 不惩罚)", async () => {
        const third = new Error("request timeout");
        const deps = makeRouteDeps({
            httpFactory: makeHttpFactory({
                "https://a.example": httpError(404),
                "https://b.example": new Error("fetch failed"),
                "https://c.example": third,
            }),
        });
        await expect(
            fetchRegistryByRoute(
                deps,
                "pkg",
                ["https://a.example", "https://b.example", "https://c.example"],
                deps.scope.current,
            ),
        ).rejects.toThrow("request timeout");
        expect(deps.recordRouteFailure).toHaveBeenCalledTimes(2);
        expect(deps.recordRouteFailure).toHaveBeenCalledWith("https://b.example", "network");
        expect(deps.recordRouteFailure).toHaveBeenCalledWith("https://c.example", "timeout");
        expect((third as { marketNextReasons?: string[] }).marketNextReasons).toEqual([
            "not-found",
            "network",
            "timeout",
        ]);
    });

    it("竞速过程日志经 debug 通道输出", async () => {
        const deps = makeRouteDeps();
        await fetchRegistryByRoute(deps, "pkg", [PRIMARY_ENDPOINT], deps.scope.current);
        expect(deps.log.debug).toHaveBeenCalledWith(expect.stringContaining("npm registry"));
    });
});
