import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KoishiClientStub } from "../../__tests__/helpers";

/**
 * @file config.ts 的单元测试:插件配置节点的递归定位(禁用/分组/注释键)、
 * 更新策略读取(纯读与可写形态)、偏好开关读取、双写补丁的成败分支。
 */

vi.mock("@koishi-ce/client", async () => {
    const { createKoishiClientStub } = await import("../../__tests__/helpers");
    return createKoishiClientStub();
});

// vi.mock 只是运行时替换,tsc 仍按真实模块类型推导;统一断言为桩视图
const { send, store } = (await import("@koishi-ce/client")) as unknown as KoishiClientStub;
const {
    active,
    getBulkMode,
    getMarketNextConfig,
    getMarketNextPolicy,
    getRemoveConfig,
    getWritableMarketNextPolicy,
    hasOwn,
    patchMarketNextConfig,
} = await import("../config");

beforeEach(() => {
    send.mockReset();
    store.config = {};
    store.marketData = undefined;
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("findMarketNextConfig(经 getMarketNextConfig)", () => {
    it("无配置树或配置树非对象时返回 undefined", () => {
        expect(getMarketNextConfig()).toBeUndefined();
        store.config = { plugins: null };
        expect(getMarketNextConfig()).toBeUndefined();
        store.config = { plugins: 42 };
        expect(getMarketNextConfig()).toBeUndefined();
    });

    it("顶层两种键名都能定位", () => {
        const byShort = { bulkMode: true };
        store.config = { plugins: { "market-next": byShort } };
        expect(getMarketNextConfig()).toBe(byShort);
        const byFull = { bulkMode: false };
        store.config = { plugins: { "@koishi-ce/plugin-marketn": byFull } };
        expect(getMarketNextConfig()).toBe(byFull);
    });

    it("$ 前缀的注释/元信息键跳过,非对象值跳过", () => {
        store.config = { plugins: { $schema: { evil: true }, "market-next": 42, other: "x" } };
        expect(getMarketNextConfig()).toBeUndefined();
    });

    it("禁用(~ 前缀)节点记作备选,存在启用节点时优先启用节点", () => {
        const disabled = { bulkMode: false };
        const enabled = { bulkMode: true };
        store.config = {
            plugins: { "~market-next": disabled, "@koishi-ce/plugin-marketn": enabled },
        };
        expect(getMarketNextConfig()).toBe(enabled);
    });

    it("全部禁用时返回禁用节点(保证仍可读写)", () => {
        const disabled = { bulkMode: true };
        store.config = { plugins: { "~market-next": disabled } };
        expect(getMarketNextConfig()).toBe(disabled);
    });

    it("嵌套在 group 分组里的配置节点可递归定位", () => {
        const nested = { bulkMode: true };
        store.config = { plugins: { group: { "~other": {}, "market-next": nested } } };
        expect(getMarketNextConfig()).toBe(nested);
    });

    it("分组内全部禁用时返回分组内禁用节点;非 group 键不递归", () => {
        const nestedDisabled = { bulkMode: true };
        store.config = { plugins: { group: { "~market-next": nestedDisabled } } };
        expect(getMarketNextConfig()).toBe(nestedDisabled);
        const hidden = { bulkMode: true };
        store.config = { plugins: { folder: { "market-next": hidden } } };
        expect(getMarketNextConfig()).toBeUndefined();
    });

    it("键名带冒号后缀时按冒号前的名字匹配", () => {
        const tagged = { bulkMode: true };
        store.config = { plugins: { "market-next:tag": tagged } };
        expect(getMarketNextConfig()).toBe(tagged);
    });
});

describe("getMarketNextPolicy", () => {
    it("只挑已显式配置的全局开关,忽略记录始终以数据仓为准", () => {
        store.config = {
            plugins: {
                "market-next": {
                    updateIgnoreDuration: 5,
                    updateIgnoredPackages: "x",
                    bulkMode: true,
                },
            },
        };
        store.marketData = { updateIgnored: { "pkg-a": "1.0.0" } };
        expect(getMarketNextPolicy()).toEqual({
            updateIgnoredPackages: "x",
            updateIgnoreDuration: 5,
            updateIgnored: { "pkg-a": "1.0.0" },
        });
    });

    it("数据仓缺 updateIgnored 时给空对象兜底", () => {
        store.marketData = {};
        expect(getMarketNextPolicy().updateIgnored).toEqual({});
    });
});

describe("getWritableMarketNextPolicy", () => {
    it("把数据仓的忽略记录同步进插件配置节点并返回同一引用", () => {
        const node: Record<string, any> = { bulkMode: true };
        store.config = { plugins: { "market-next": node } };
        const policy = getWritableMarketNextPolicy();
        expect(policy).toBe(node);
        expect(node.updateIgnored).toBe(getWritableMarketNextPolicy().updateIgnored);
    });

    it("插件未配置时返回仅含忽略记录的可写对象", () => {
        const policy = getWritableMarketNextPolicy();
        expect(policy).toEqual({ updateIgnored: {} });
    });
});

describe("getBulkMode / getRemoveConfig", () => {
    it("未配置时 bulkMode 为 false、removeConfig 为 undefined", () => {
        expect(getBulkMode()).toBe(false);
        expect(getRemoveConfig()).toBeUndefined();
    });

    it("显式配置 true/false 均按原值返回(区分 false 与未配置)", () => {
        store.config = { plugins: { "market-next": { bulkMode: true, removeConfig: false } } };
        expect(getBulkMode()).toBe(true);
        expect(getRemoveConfig()).toBe(false);
        store.config = { plugins: { "market-next": { bulkMode: false, removeConfig: true } } };
        expect(getBulkMode()).toBe(false);
        expect(getRemoveConfig()).toBe(true);
    });
});

describe("patchMarketNextConfig", () => {
    it("本地配置节点立即合并,RPC 成功返回其结果", async () => {
        const node = { bulkMode: false };
        store.config = { plugins: { "market-next": node } };
        send.mockResolvedValue("saved");
        await expect(
            patchMarketNextConfig({ bulkMode: true, updateIgnoreDuration: 5 }),
        ).resolves.toBe("saved");
        expect(node).toMatchObject({ bulkMode: true, updateIgnoreDuration: 5 });
        expect(send).toHaveBeenCalledWith("market/update-config", {
            bulkMode: true,
            updateIgnoreDuration: 5,
        });
    });

    it("RPC 无任务返回 false,失败返回 false 并只告警", async () => {
        send.mockReturnValue(undefined);
        await expect(patchMarketNextConfig({ bulkMode: true })).resolves.toBe(false);
        send.mockRejectedValue(new Error("rpc down"));
        await expect(patchMarketNextConfig({ bulkMode: true })).resolves.toBe(false);
    });

    it("插件未配置时跳过本地合并但仍下发 RPC", async () => {
        send.mockResolvedValue(undefined);
        await patchMarketNextConfig({ bulkMode: true });
        expect(send).toHaveBeenCalled();
        expect(getMarketNextConfig()).toBeUndefined();
    });
});

describe("hasOwn / active", () => {
    it("hasOwn 收窄 undefined 源,可识别值为 undefined 的键", () => {
        expect(hasOwn(undefined, "a")).toBe(false);
        expect(hasOwn({}, "a")).toBe(false);
        expect(hasOwn({ a: undefined }, "a")).toBe(true);
    });

    it("市场条目弹层开关默认关闭", () => {
        expect(active.value).toBe("");
    });
});
