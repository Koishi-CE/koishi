import { describe, expect, it, vi } from "vitest";

/**
 * @file plugin-config 域聚合出口的测试:保证拆分后的 re-export 面
 * 与拆分前的单文件导出一致。聚合出口拉起全部子模块,宿主照例 mock。
 */

vi.mock("@koishi-ce/client", async () => {
    const { createKoishiClientStub } = await import("../../__tests__/helpers");
    return createKoishiClientStub();
});

vi.mock("../../i18n", () => ({
    translate: (key: string) => key,
}));

const pluginConfig = await import("../index");

describe("shared/plugin-config 聚合出口", () => {
    it("配置读写与数据仓", () => {
        for (const name of [
            "active",
            "getBulkMode",
            "getMarketNextConfig",
            "getMarketNextPolicy",
            "getRemoveConfig",
            "getWritableMarketNextPolicy",
            "patchMarketNextConfig",
            "getBundleRecords",
            "getCollapsedGroups",
            "getPendingOverrides",
            "getWritableBundleRecords",
            "patchMarketNextData",
        ]) {
            expect(pluginConfig).toHaveProperty(name);
        }
        expect(pluginConfig.patchMarketNextConfig).toBeTypeOf("function");
        expect(pluginConfig.active).toBeTypeOf("object");
    });

    it("更新忽略策略与静默过滤", () => {
        for (const name of [
            "createUpdateIgnoreRule",
            "getIgnoredUpdateVersion",
            "getLatestVersion",
            "getUpdateIgnoreText",
            "hasUpdate",
            "isUpdateCheckDisabled",
            "isUpdateIgnored",
            "getMarketSilentFilters",
            "getMarketSilentRules",
        ]) {
            expect(pluginConfig[name]).toBeTypeOf("function");
        }
    });
});
