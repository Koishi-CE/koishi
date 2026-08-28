/**
 * cache/index.ts 单测:PackageCache 三层缓存(fullCache/tempCache/notFoundCache)
 * 与任务单飞(pkgTasks)——成功写入/404 负缓存/失败重试/并发去重/过期防护/
 * findVersion 批量最新版本预判/clear 全清。client 走手工 mock。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MINUTE } from "../../../utils/time.js";
import {
    makeCacheClient,
    makeRegistryPayload,
    makeScope,
    remotePackage,
} from "../../client/__tests__/helpers.js";
import type { Registry } from "../../manifest.js";
import { PackageCache } from "../index.js";

const NOW = Date.parse("2026-01-01T00:00:00Z");

interface CacheHarness {
    cache: PackageCache;
    getRegistry: ReturnType<typeof vi.fn>;
    onFlush: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    scope: ReturnType<typeof makeScope>;
}

type ClientImpl = (name: string, serial: number) => Promise<Registry | undefined>;

/** 组装 PackageCache 与可断言的依赖 mock。 */
function makeHarness(getRegistry: ClientImpl): CacheHarness {
    const scope = makeScope();
    const onFlush = vi.fn();
    const warn = vi.fn();
    const clientGet = vi.fn(getRegistry);
    const cache = new PackageCache({
        client: makeCacheClient(clientGet as unknown as ClientImpl),
        scope,
        log: { debug: vi.fn(), warn },
        onFlush,
    });
    return { cache, getRegistry: clientGet, onFlush, warn, scope };
}

/** 带 not-found 归因的 404 错误。 */
function notFoundError() {
    const error = new Error("HTTP 404");
    (error as { marketNextReason?: string }).marketNextReason = "not-found";
    return error;
}

describe("PackageCache.setPackage", () => {
    it("写入两层缓存、广播增量、清除负缓存并让后续 getPackage 直接命中", async () => {
        const { cache, getRegistry, onFlush } = makeHarness(async () => {
            throw new Error("should not fetch");
        });
        // 先制造 404 负缓存
        getRegistry.mockRejectedValueOnce(notFoundError());
        await expect(cache.getPackage("pkg")).rejects.toThrow();
        expect(cache.isNotFoundCached("pkg")).toBe(true);

        cache.setPackage("pkg", [
            remotePackage("1.0.0", { koishi: "^4.0.0" }),
            remotePackage("2.0.0", { koishi: "^4.0.0" }),
        ]);
        expect(cache.isNotFoundCached("pkg")).toBe(false);
        expect(Object.keys(cache.fullCache["pkg"]!)).toEqual(["2.0.0", "1.0.0"]);
        expect(cache.tempCache["pkg"]).toBe(cache.fullCache["pkg"]);
        expect(onFlush).toHaveBeenCalled();
        // pkgTasks 已置为已完成的 promise:后续 getPackage 零请求
        await expect(cache.getPackage("pkg")).resolves.toBe(cache.fullCache["pkg"]);
        expect(getRegistry).toHaveBeenCalledTimes(1);
    });
});

describe("PackageCache.getPackage", () => {
    it("成功:拉取、过滤兼容版本、写两层缓存并广播", async () => {
        const payload = makeRegistryPayload([
            { version: "1.0.0", peerDependencies: { koishi: "^3.0.0" } },
            { version: "2.0.0", peerDependencies: { koishi: "^4.0.0" } },
        ]);
        const { cache, getRegistry, onFlush, scope } = makeHarness(async () => payload);
        const versions = await cache.getPackage("koishi-plugin-demo");
        // 插件包按 koishi4 兼容性过滤后仅剩 2.0.0,且按 semver 降序
        expect(Object.keys(versions!)).toEqual(["2.0.0"]);
        expect(Object.keys(cache.fullCache["koishi-plugin-demo"]!)).toEqual(["2.0.0"]);
        expect(onFlush).toHaveBeenCalled();
        expect(getRegistry).toHaveBeenCalledWith("koishi-plugin-demo", scope.current);
    });

    it("非插件包不过滤版本", async () => {
        const payload = makeRegistryPayload([
            { version: "1.0.0" },
            { version: "2.0.0", peerDependencies: { koishi: "^4.0.0" } },
        ]);
        const { cache } = makeHarness(async () => payload);
        const versions = await cache.getPackage("lodash");
        expect(Object.keys(versions!)).toEqual(["2.0.0", "1.0.0"]);
    });

    it("404 失败:写入负缓存,TTL 内不再重复请求", async () => {
        const { cache, getRegistry } = makeHarness(async () => {
            throw notFoundError();
        });
        await expect(cache.getPackage("pkg")).rejects.toThrow("HTTP 404");
        expect(cache.notFoundAt("pkg")).toBeTypeOf("number");
        expect(cache.isNotFoundCached("pkg")).toBe(true);
        // 负缓存命中:直接 undefined,不再发请求
        await expect(cache.getPackage("pkg")).resolves.toBeUndefined();
        expect(getRegistry).toHaveBeenCalledTimes(1);
    });

    it("非 404 失败:不写负缓存,允许重试", async () => {
        const { cache, getRegistry } = makeHarness(async () => {
            throw new Error("fetch failed");
        });
        await expect(cache.getPackage("pkg")).rejects.toThrow("fetch failed");
        expect(cache.isNotFoundCached("pkg")).toBe(false);
        await expect(cache.getPackage("pkg")).rejects.toThrow("fetch failed");
        expect(getRegistry).toHaveBeenCalledTimes(2);
    });

    it("失败时输出告警日志", async () => {
        const { cache, warn } = makeHarness(async () => {
            throw new Error("fetch failed");
        });
        await expect(cache.getPackage("pkg")).rejects.toThrow();
        expect(warn).toHaveBeenCalledWith("fetch failed");
    });

    it("非 Error 异常按字符串化输出告警", async () => {
        const { cache, warn } = makeHarness(async () => {
            throw "boom";
        });
        await expect(cache.getPackage("pkg")).rejects.toBe("boom");
        expect(warn).toHaveBeenCalledWith("boom");
    });

    it("失败任务被 clear 顶替后:不写负缓存也不清理新状态", async () => {
        let reject!: (reason: unknown) => void;
        const pending = new Promise<Registry>((_resolve, rejectFn) => {
            reject = rejectFn;
        });
        const { cache } = makeHarness(() => pending);
        const task = cache.getPackage("pkg");
        cache.clear();
        reject(notFoundError());
        await expect(task).rejects.toThrow("HTTP 404");
        // 顶替后错误回调直接返回:负缓存未写入
        expect(cache.isNotFoundCached("pkg")).toBe(false);
    });

    it("单飞去重:同包并发请求共享一次拉取", async () => {
        let release!: (value: Registry) => void;
        const pending = new Promise<Registry>((resolve) => {
            release = resolve;
        });
        const { cache, getRegistry } = makeHarness(() => pending);
        const first = cache.getPackage("pkg");
        const second = cache.getPackage("pkg");
        release(makeRegistryPayload());
        const [a, b] = await Promise.all([first, second]);
        expect(a).toBe(b);
        expect(getRegistry).toHaveBeenCalledTimes(1);
    });

    it("任务被 clear 顶替后 resolve:结果正常返回且不清理新状态", async () => {
        let release!: (value: Registry) => void;
        const pending = new Promise<Registry>((resolve) => {
            release = resolve;
        });
        const { cache } = makeHarness(() => pending);
        const task = cache.getPackage("pkg");
        cache.clear();
        release(makeRegistryPayload());
        await expect(task).resolves.toBeDefined();
    });

    it("请求过期(竞速域推进):返回 undefined 且不落缓存", async () => {
        const { cache, scope } = makeHarness(async () => {
            scope.advance("new round");
            return makeRegistryPayload();
        });
        await expect(cache.getPackage("pkg")).resolves.toBeUndefined();
        expect(cache.fullCache["pkg"]).toBeUndefined();
    });

    it("getRegistry 返回 undefined(如上游复用旧值):返回 undefined 且不落缓存", async () => {
        const { cache } = makeHarness(async () => undefined);
        await expect(cache.getPackage("pkg")).resolves.toBeUndefined();
        expect(cache.fullCache["pkg"]).toBeUndefined();
    });
});

describe("PackageCache 404 负缓存 TTL", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("TTL 过期后重新拉取并清除负缓存", async () => {
        const { cache, getRegistry } = makeHarness(async () => {
            throw notFoundError();
        });
        await expect(cache.getPackage("pkg")).rejects.toThrow();
        expect(cache.isNotFoundCached("pkg")).toBe(true);

        // 过期后改判成功:重新发请求
        getRegistry.mockResolvedValueOnce(makeRegistryPayload());
        vi.setSystemTime(NOW + 5 * MINUTE + 1);
        expect(cache.isNotFoundCached("pkg")).toBe(false);
        const versions = await cache.getPackage("pkg");
        expect(versions).toBeDefined();
        expect(getRegistry).toHaveBeenCalledTimes(2);
    });

    it("TTL 内命中负缓存时顺带清除过期时间戳以外的状态", async () => {
        const { cache, getRegistry } = makeHarness(async () => {
            throw notFoundError();
        });
        await expect(cache.getPackage("pkg")).rejects.toThrow();
        vi.setSystemTime(NOW + MINUTE);
        await expect(cache.getPackage("pkg")).resolves.toBeUndefined();
        expect(getRegistry).toHaveBeenCalledTimes(1);
    });
});

describe("PackageCache.findVersion", () => {
    it("并行拉取,取第一个有版本结果的包的最新版本", async () => {
        const { cache } = makeHarness(async (name: string) => {
            if (name === "a") throw notFoundError();
            return makeRegistryPayload([
                { version: "1.0.0", peerDependencies: { koishi: "^4.0.0" } },
                { version: "3.2.1", peerDependencies: { koishi: "^4.0.0" } },
            ]);
        });
        await expect(cache.findVersion(["a", "b"])).resolves.toEqual({ b: "3.2.1" });
    });

    it("全部候选失败或无版本时返回 undefined", async () => {
        const failing = makeHarness(async () => {
            throw new Error("fetch failed");
        });
        await expect(failing.cache.findVersion(["a", "b"])).resolves.toBeUndefined();

        const empty = makeHarness(async () => makeRegistryPayload([]));
        await expect(empty.cache.findVersion(["a"])).resolves.toBeUndefined();
    });

    it("负缓存命中的包按无版本处理,取后续候选", async () => {
        const { cache } = makeHarness(async (name: string) => {
            if (name === "a") throw notFoundError();
            return makeRegistryPayload();
        });
        await expect(cache.getPackage("a")).rejects.toThrow();
        // a 处于 404 负缓存(getPackage → undefined),findVersion 落到 b
        await expect(cache.findVersion(["a", "b"])).resolves.toEqual({ b: "1.0.0" });
    });

    it("空候选列表返回 undefined", async () => {
        const { cache } = makeHarness(async () => makeRegistryPayload());
        await expect(cache.findVersion([])).resolves.toBeUndefined();
    });
});

describe("PackageCache.clear", () => {
    it("全量清空四层状态", async () => {
        const { cache } = makeHarness(async () => makeRegistryPayload());
        await cache.getPackage("pkg");
        expect(cache.fullCache["pkg"]).toBeDefined();

        cache.clear();
        expect(cache.fullCache).toEqual({});
        expect(cache.tempCache).toEqual({});
        expect(cache.notFoundAt("pkg")).toBeUndefined();
    });
});
