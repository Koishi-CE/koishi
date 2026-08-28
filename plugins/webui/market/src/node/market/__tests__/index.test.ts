/**
 * index.ts 单测:MarketProvider 的 createDeps 接线(http/throttle/broadcast/
 * setPackage 透传)、get() 字段映射(含 fallback 分支)、start/probeInBackground
 * 委托、ready 预热与析构 dispose,以及 MarketProviderConfig schema 默认值。
 *
 * 策略:MarketIndexSource 用真实类(构造无 I/O),仅 spy 实例方法
 * (start/warmDiskCache/probeInBackground/getSnapshot)阻断网络链路。
 */
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketSnapshotInput } from "../../../core/market/snapshot.js";
import { DEFAULT_ENDPOINT } from "../../../core/market/source/endpoints.js";
import type { MarketIndexSource, MarketSourceDeps } from "../../../core/market/source/index.js";
import type { MarketPayload } from "../../../shared/types.js";
import { MarketProvider, MarketProviderConfig } from "../index.js";
import { createMockContext, type MockContext } from "./helpers.js";

// vitest 的 ESM 链直连 koishi 会触发 @koishijs/loader 的互操作崩溃,
// 这里把 koishi mock 成 CJS 产物(require 链验证可用),Schema/Time 均为真实符号。
/** 拿到 provider 的私有 source(类型桥接)。 */
function sourceOf(provider: MarketProvider): MarketIndexSource {
    return (provider as unknown as { source: MarketIndexSource }).source;
}

function depsOf(provider: MarketProvider): MarketSourceDeps {
    return sourceOf(provider).deps;
}

let ctx: MockContext;

beforeEach(() => {
    ctx = createMockContext();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("MarketProviderConfig schema", () => {
    it("默认值:endpoint/timeout/autoRoute/logLevel(断言 Schema 结构描述字段)", () => {
        // cordis Schema 实例无 parse 方法,以描述符里的 default 为准
        const dict = MarketProviderConfig.dict as Record<string, { meta?: { default?: unknown } }>;
        expect(dict["endpoint"]?.meta?.default).toBe(DEFAULT_ENDPOINT);
        expect(dict["timeout"]?.meta?.default).toBe(30000);
        expect(dict["autoRoute"]?.meta?.default).toBe(true);
        expect(dict["logLevel"]?.meta?.default).toBe("warn");
        expect(dict["proxyAgent"]?.meta?.default).toBeUndefined();
    });
});

describe("MarketProvider", () => {
    it("构造挂 market 通道监听(经 BaseMarketProvider)与 ready/effect 钩子", () => {
        const provider = new MarketProvider(ctx.asContext());

        expect(ctx.console.addListener).toHaveBeenCalledWith(
            "market/refresh",
            expect.any(Function),
            { authority: 4 },
        );
        expect(ctx.on).toHaveBeenCalledWith("ready", expect.any(Function));
        expect(ctx.effect).toHaveBeenCalled();

        // market/refresh 监听器触发 start(true)
        const start = vi.spyOn(sourceOf(provider), "start").mockResolvedValue();
        vi.mocked(ctx.console.addListener).mock.calls[0]?.[1]();
        expect(start).toHaveBeenCalledWith(true);
    });

    it("析构时 dispose source 竞速域", () => {
        const provider = new MarketProvider(ctx.asContext());
        const source = sourceOf(provider);

        ctx.close();
        expect(source.scope.isDisposed).toBe(true);
    });

    it("ready 事件触发 warmDiskCache(startup)", () => {
        const provider = new MarketProvider(ctx.asContext());
        const warm = vi.spyOn(sourceOf(provider), "warmDiskCache").mockResolvedValue(false);

        ctx.trigger("ready");
        // immediate 服务未标记,ready 后 cordis 会把实例 set 进 ctx
        expect(warm).toHaveBeenCalledWith("startup");
    });

    describe("createDeps 接线", () => {
        it("http:endpoint+timeout 透传给 ctx.http.extend,getText 映射响应", async () => {
            const provider = new MarketProvider(ctx.asContext(), { timeout: 5000 });
            const client = vi.fn(async () => ({
                status: 200,
                data: "body",
                headers: { etag: "w/1" },
            }));
            ctx.http.extend.mockImplementation(() => client as never);

            const http = depsOf(provider).http("https://ep.example");
            expect(ctx.http.extend).toHaveBeenCalledWith({
                endpoint: "https://ep.example",
                timeout: 5000,
            });

            const response = await http.getText("/index.json", {
                headers: { "if-none-match": "w/1" },
                signal: undefined,
                validateStatus: () => true,
            });
            expect(client).toHaveBeenCalledWith("/index.json", {
                responseType: "text",
                headers: { "if-none-match": "w/1" },
                signal: undefined,
                validateStatus: expect.any(Function),
            });
            expect(response).toEqual({ status: 200, data: "body", headers: { etag: "w/1" } });
        });

        it("timeout 未配置时 extend 参数不含 timeout 键", async () => {
            const provider = new MarketProvider(ctx.asContext());
            ctx.http.extend.mockImplementation(() => vi.fn(async () => ({ status: 200 })));

            depsOf(provider).http("https://ep2.example");

            expect(ctx.http.extend).toHaveBeenCalledTimes(1);
            expect(
                Object.hasOwn(vi.mocked(ctx.http.extend).mock.calls[0]?.[0] as object, "timeout"),
            ).toBe(false);
        });

        it("scannerRequest/notifyRefresh/onRegistryVersions 直接透传", async () => {
            const provider = new MarketProvider(ctx.asContext());
            const deps = depsOf(provider);

            await deps.scannerRequest("https://registry.example/-/all", { timeout: 8 });
            expect(ctx.http.get).toHaveBeenCalledWith("https://registry.example/-/all", {
                timeout: 8,
            });

            void deps.notifyRefresh();
            expect(ctx.console.refresh).toHaveBeenCalledWith("market");

            const versions = [{ name: "koishi-plugin-foo", version: "1.0.0" }];
            deps.onRegistryVersions("koishi-plugin-foo", versions);
            expect(ctx.installer.setPackage).toHaveBeenCalledWith("koishi-plugin-foo", versions);
        });

        it("broadcastPatch 经 throttle 透传到 console 广播", () => {
            const provider = new MarketProvider(ctx.asContext());

            const patch = { data: {}, revision: 1, total: 0, progress: 1, failed: 0 };
            depsOf(provider).broadcastPatch(patch);

            expect(ctx.throttle).toHaveBeenCalledWith(expect.any(Function), 500);
            expect(ctx.console.broadcast).toHaveBeenCalledWith("market/patch", patch);
        });

        it("缓存文件路径按 baseDir 派生", () => {
            const provider = new MarketProvider(ctx.asContext());
            const deps = depsOf(provider);

            expect(deps.cacheFile).toBe(resolve("/mock-base", "cache", "market-next-index.json"));
            expect(deps.cacheDir).toBe(resolve("/mock-base", "cache", "market-next-index"));
        });

        it("log 门控:默认 warn 级(debug/info 静默,warn 输出)", () => {
            const provider = new MarketProvider(ctx.asContext());
            const log = depsOf(provider).log;

            log.debug("d");
            log.info("i");
            log.warn("w");

            expect(ctx.log.info).not.toHaveBeenCalled();
            expect(ctx.log.warn).toHaveBeenCalledWith("w");
        });

        it("log 门控:debug 级镜像为 info", () => {
            const provider = new MarketProvider(ctx.asContext(), { logLevel: "debug" });
            const log = depsOf(provider).log;

            log.debug("d");
            log.info("i");
            log.warn("w");

            expect(ctx.log.info).toHaveBeenCalledWith("[debug] d");
            expect(ctx.log.info).toHaveBeenCalledWith("i");
            expect(ctx.log.warn).toHaveBeenCalledWith("w");
        });

        it("log 门控:silent 全静默,error 时 warn 静默、info 级时 debug 静默", () => {
            const silent = new MarketProvider(ctx.asContext(), { logLevel: "silent" });
            depsOf(silent).log.debug("d");
            depsOf(silent).log.info("i");
            depsOf(silent).log.warn("w");
            expect(ctx.log.info).not.toHaveBeenCalled();
            expect(ctx.log.warn).not.toHaveBeenCalled();

            const error = new MarketProvider(ctx.asContext(), { logLevel: "error" });
            depsOf(error).log.warn("w");
            expect(ctx.log.warn).not.toHaveBeenCalled();

            const info = new MarketProvider(ctx.asContext(), { logLevel: "info" });
            depsOf(info).log.debug("d");
            depsOf(info).log.info("i");
            expect(ctx.log.info).toHaveBeenCalledWith("i");
            expect(ctx.log.info).not.toHaveBeenCalledWith("[debug] d");
        });
    });

    describe("get() 字段映射", () => {
        it("无数据初始态:registry 回退端点,loading=true", async () => {
            const provider = new MarketProvider(ctx.asContext());

            const payload = await provider.get();

            expect(payload).toMatchObject({
                registry: DEFAULT_ENDPOINT,
                failed: 0,
                total: undefined,
                stale: false,
                cached: false,
                loading: true,
                refreshing: false,
                revision: 0,
                dataVersion: 0,
                gravatar: process.env["GRAVATAR_MIRROR"],
            });
            expect(payload.error).toBeUndefined();
            expect(payload.debug).toBeUndefined();
            expect(typeof payload.serverNow).toBe("number");
        });

        it("配置端点透传,当前 registry 优先于端点", async () => {
            const provider = new MarketProvider(ctx.asContext(), { endpoint: "https://custom" });
            expect((await provider.get()).registry).toBe("https://custom");

            sourceOf(provider).endpoint = "https://winner";
            expect((await provider.get()).registry).toBe("https://winner");
        });

        it("快照载荷映射:failed/stale/error/cached/时间戳与 loading=false", async () => {
            const provider = new MarketProvider(ctx.asContext());
            const source = sourceOf(provider);
            source.payloadValue = {
                registry: "https://live",
                failed: 2,
                stale: true,
                error: "boom",
                cached: true,
                cachedAt: 111,
                validatedAt: 222,
            } as unknown as MarketSnapshotInput;
            source.scanner.total = 7;
            source.scanner.progress = 0.5;
            source.backgroundTask = Promise.resolve();

            const payload = await provider.get();

            expect(payload).toMatchObject({
                registry: "https://live",
                failed: 2,
                total: 7,
                progress: 0.5,
                stale: true,
                error: "boom",
                cached: true,
                cachedAt: 111,
                validatedAt: 222,
                refreshing: true,
                loading: false,
            });
        });

        it("collectError 兜底 error 字段且不算 loading", async () => {
            const provider = new MarketProvider(ctx.asContext());
            sourceOf(provider).collectError = new Error("collect failed");

            const payload = await provider.get();

            expect(payload.error).toBe("collect failed");
            expect(payload.loading).toBe(false);
        });

        it("revision 每次应用递增,dataVersion 仅内容变化递增", async () => {
            const provider = new MarketProvider(ctx.asContext());
            const source = sourceOf(provider);
            const index = (version: number) => ({ objects: [], version, total: 0, time: "" });

            source.applyIndex(index(1), "https://a", "hash-1");
            let payload = await provider.get();
            expect(payload.revision).toBe(1);
            expect(payload.dataVersion).toBe(1);

            source.applyIndex(index(2), "https://a", "hash-1");
            payload = await provider.get();
            expect(payload.revision).toBe(2);
            expect(payload.dataVersion).toBe(1);

            source.applyIndex(index(3), "https://a", "hash-2");
            payload = await provider.get();
            expect(payload.revision).toBe(3);
            expect(payload.dataVersion).toBe(2);
        });

        it("logLevel=debug 时暴露 debug 信息,否则不暴露", async () => {
            const provider = new MarketProvider(ctx.asContext(), { logLevel: "debug" });
            const source = sourceOf(provider);
            source.updateDebugInfo({ timings: { total: 42 } });

            expect((await provider.get()).debug).toMatchObject({ timings: { total: 42 } });

            const quiet = new MarketProvider(ctx.asContext());
            sourceOf(quiet).updateDebugInfo({ timings: { total: 42 } });
            expect((await quiet.get()).debug).toBeUndefined();
        });
    });

    it("start/getSnapshot/probeInBackground 委托 source", async () => {
        const provider = new MarketProvider(ctx.asContext());
        const source = sourceOf(provider);
        const start = vi.spyOn(source, "start").mockResolvedValue();
        const probe = vi.spyOn(source, "probeInBackground").mockResolvedValue(true);
        const snapshot = { total: 3, failed: 0, progress: 1 } as MarketPayload;
        // 接口签名是 Promise<MarketPayload>,真实实现同步返回(此处 mock 直返)
        vi.spyOn(source, "getSnapshot").mockReturnValue(snapshot as never);

        await provider.start(true);
        expect(start).toHaveBeenCalledWith(true);

        expect(await provider.getSnapshot()).toBe(snapshot);

        await provider.probeInBackground("why");
        expect(probe).toHaveBeenCalledWith("why");

        await provider.probeInBackground();
        expect(probe).toHaveBeenCalledWith("idle probe");
    });
});
