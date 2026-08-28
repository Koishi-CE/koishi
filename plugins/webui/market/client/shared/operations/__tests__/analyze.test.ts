import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KoishiClientStub } from "../../__tests__/helpers";

/**
 * @file analyzeVersions / getRegistryStatus(Text) 的单元测试。
 *
 * @koishi-ce/client 用共享桩替换,translate 可编程,聚焦验证:peer 兼容性判定
 * 矩阵(满足/不满足/缺失/optional)、deprecated 特判、版本查找优先级、
 * registry 拉取状态文案的全部分支与端点格式化。
 */

vi.mock("@koishi-ce/client", async () => {
    const { createKoishiClientStub } = await import("../../__tests__/helpers");
    return createKoishiClientStub();
});

const i18nMock = vi.hoisted(() => ({
    translate: vi.fn((key: string, params?: any) =>
        params ? `${key}:${JSON.stringify(params)}` : key,
    ),
}));

vi.mock("../../i18n", () => ({ translate: i18nMock.translate }));

// vi.mock 只是运行时替换,tsc 仍按真实模块类型推导;统一断言为桩视图
const { store } = (await import("@koishi-ce/client")) as unknown as KoishiClientStub;
const { analyzeVersions, getRegistryStatus, getRegistryStatusText } = await import(
    "../analyze"
);
const { manualDeps } = await import("../state");
const { endpointHost } = await import("../../format");

/** 便捷构造:单版本 registry 元数据。 */
function registryWithVersion(peerDependencies: any, extra: any = {}) {
    return { "1.0.0": { peerDependencies, ...extra } };
}

beforeEach(() => {
    store.registry = {};
    store.dependencies = {};
    store.packages = {};
    store.registryStatus = undefined;
    for (const key of Object.keys(manualDeps)) delete manualDeps[key];
    i18nMock.translate.mockClear();
});

describe("analyzeVersions", () => {
    it("无 registry 且无手动缓存时返回 undefined", () => {
        expect(analyzeVersions("pkg-a", () => null)).toBeUndefined();
    });

    it("peer 满足期望范围时标 success", () => {
        store.registry = { "pkg-a": registryWithVersion({ foo: "^1.0.0" }) };
        store.dependencies = { foo: { resolved: "1.2.0" } };
        const result = analyzeVersions("pkg-a", () => null) as any;
        expect(result["1.0.0"].result).toBe("success");
        expect(result["1.0.0"].peers.foo).toMatchObject({
            request: "^1.0.0",
            resolved: "1.2.0",
            result: "success",
        });
    });

    it("peer 不满足期望范围时该 peer 与整版本标 danger", () => {
        store.registry = { "pkg-a": registryWithVersion({ foo: "^1.0.0" }) };
        store.dependencies = { foo: { resolved: "2.0.0" } };
        const result = analyzeVersions("pkg-a", () => null) as any;
        expect(result["1.0.0"].peers.foo.result).toBe("danger");
        expect(result["1.0.0"].result).toBe("danger");
    });

    it("必需 peer 缺失时标 danger", () => {
        store.registry = { "pkg-a": registryWithVersion({ foo: "^1.0.0" }) };
        const result = analyzeVersions("pkg-a", () => null) as any;
        expect(result["1.0.0"].peers.foo.result).toBe("danger");
        expect(result["1.0.0"].result).toBe("danger");
    });

    it("optional peer 缺失时仅标 primary,整版本不因此 danger", () => {
        store.registry = {
            "pkg-a": registryWithVersion(
                { foo: "^1.0.0" },
                { peerDependenciesMeta: { foo: { optional: true } } },
            ),
        };
        const result = analyzeVersions("pkg-a", () => null) as any;
        expect(result["1.0.0"].peers.foo.result).toBe("primary");
        expect(result["1.0.0"].result).toBe("success");
    });

    it("deprecated 版本直接标 danger(即使 peer 全部满足)", () => {
        store.registry = {
            "pkg-a": registryWithVersion({ foo: "^1.0.0" }, { deprecated: "use v2" }),
        };
        store.dependencies = { foo: { resolved: "1.2.0" } };
        const result = analyzeVersions("pkg-a", () => null) as any;
        expect(result["1.0.0"].result).toBe("danger");
    });

    it("getVersion 回调优先于 store.dependencies 与 store.packages", () => {
        store.registry = { "pkg-a": registryWithVersion({ foo: "^1.0.0" }) };
        store.dependencies = { foo: { resolved: "2.0.0" } };
        store.packages = { foo: { package: { version: "2.1.0" } } };
        const result = analyzeVersions("pkg-a", () => "1.5.0") as any;
        expect(result["1.0.0"].peers.foo.resolved).toBe("1.5.0");
        expect(result["1.0.0"].peers.foo.result).toBe("success");
    });

    it("缺 dependencies 时回退 store.packages 的版本元数据", () => {
        store.registry = { "pkg-a": registryWithVersion({ foo: "^1.0.0" }) };
        store.packages = { foo: { package: { version: "1.1.0" } } };
        const result = analyzeVersions("pkg-a", () => null) as any;
        expect(result["1.0.0"].peers.foo.resolved).toBe("1.1.0");
        expect(result["1.0.0"].result).toBe("success");
    });

    it("peer 含预发布版本时 includePrerelease 生效", () => {
        store.registry = { "pkg-a": registryWithVersion({ foo: "^1.0.0-beta.1" }) };
        store.dependencies = { foo: { resolved: "1.0.0-beta.2" } };
        const result = analyzeVersions("pkg-a", () => null) as any;
        expect(result["1.0.0"].peers.foo.result).toBe("success");
    });

    it("registry 优先于 manualDeps;registry 缺该包时回退 manualDeps", () => {
        manualDeps["pkg-a"] = { versions: registryWithVersion({ foo: "^2.0.0" }) } as any;
        store.registry = { "pkg-a": registryWithVersion({ foo: "^1.0.0" }) };
        store.dependencies = { foo: { resolved: "1.2.0" } };
        expect((analyzeVersions("pkg-a", () => null) as any)["1.0.0"].peers.foo.request).toBe(
            "^1.0.0",
        );
        store.registry = {};
        expect((analyzeVersions("pkg-a", () => null) as any)["1.0.0"].peers.foo.request).toBe(
            "^2.0.0",
        );
    });

    it("registry 存在但版本表为空对象时返回空结果(不回退 manualDeps)", () => {
        manualDeps["pkg-a"] = { versions: registryWithVersion({ foo: "^2.0.0" }) } as any;
        store.registry = { "pkg-a": {} };
        expect(analyzeVersions("pkg-a", () => null)).toEqual({});
    });

    it("多版本聚合:任一版本有 danger peer 即整体 danger,无 peer 的版本为 success", () => {
        store.registry = {
            "pkg-a": {
                "1.0.0": { peerDependencies: {} },
                "2.0.0": { peerDependencies: { foo: "^1.0.0" } },
            },
        };
        store.dependencies = { foo: { resolved: "9.0.0" } };
        const result = analyzeVersions("pkg-a", () => null) as any;
        expect(result["1.0.0"].result).toBe("success");
        expect(result["1.0.0"].peers).toEqual({});
        expect(result["2.0.0"].result).toBe("danger");
    });

    it("版本条目缺 peerDependencies 字段时按空 peer 处理", () => {
        store.registry = { "pkg-a": { "1.0.0": {} } };
        const result = analyzeVersions("pkg-a", () => null) as any;
        expect(result["1.0.0"]).toMatchObject({ peers: {}, result: "success" });
    });
});

describe("getRegistryStatus / getRegistryStatusText", () => {
    it("无状态时返回 undefined,文案走 loading", () => {
        expect(getRegistryStatus("pkg-a")).toBeUndefined();
        expect(getRegistryStatusText("pkg-a")).toBe(
            'dependencyCard.registry.loading:{"endpoint":"","attempts":""}',
        );
    });

    it("loading 中带端点与重试次数时拼进 loading 文案", () => {
        store.registryStatus = {
            "pkg-a": { loading: true, endpoint: "https://registry.npmmirror.com/x", attempts: 2 },
        };
        expect(getRegistryStatusText("pkg-a")).toBe(
            'dependencyCard.registry.loading:{"endpoint":" (registry.npmmirror.com)",' +
                '"attempts":", dependencyCard.registry.attempts:{\\"count\\":2}"}',
        );
    });

    it("五种失败原因各有专属文案,unknown/缺省走默认分支", () => {
        const cases: Array<[string, string]> = [
            ["timeout", "dependencyCard.registry.timeout"],
            ["not-found", "dependencyCard.registry.notFound"],
            ["network", "dependencyCard.registry.network"],
            ["invalid", "dependencyCard.registry.invalid"],
            ["http", "dependencyCard.registry.http"],
            ["unknown", "dependencyCard.registry.unknown"],
        ];
        for (const [reason, expectedKey] of cases) {
            store.registryStatus = { "pkg-a": { reason, endpoint: "https://r.example.com/y" } };
            expect(getRegistryStatusText("pkg-a")).toContain(expectedKey);
        }
        store.registryStatus = { "pkg-a": {} };
        expect(getRegistryStatusText("pkg-a")).toBe(
            'dependencyCard.registry.unknown:{"endpoint":"","error":""}',
        );
    });

    it("默认分支追加 error 摘要,无端点时不带括号", () => {
        store.registryStatus = { "pkg-a": { reason: "unknown", error: "boom" } };
        expect(getRegistryStatusText("pkg-a")).toBe(
            'dependencyCard.registry.unknown:{"endpoint":"","error":": boom"}',
        );
    });
});

describe("endpointHost", () => {
    it("URL 只保留 host 部分", () => {
        expect(endpointHost("https://registry.npmmirror.com/path?query=1")).toBe(
            "registry.npmmirror.com",
        );
    });

    it("无法解析的端点原样返回", () => {
        expect(endpointHost("relative-path")).toBe("relative-path");
    });
});
