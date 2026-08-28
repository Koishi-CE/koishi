import { describe, expect, it, vi } from "vitest";

// koishi 的 Schema/Time 只在模块加载期构建配置树,用可链式调用的桩替换,
// 避免测试环境引入完整 koishi 运行时。
vi.mock("@koishi-ce/koishi", () => {
    const stub = () => {
        const node: Record<string, unknown> = {};
        for (const method of [
            "description",
            "role",
            "default",
            "hidden",
            "i18n",
            "min",
            "max",
            "step",
        ]) {
            node[method] = vi.fn(() => node);
        }
        return node;
    };
    const Schema = {
        object: vi.fn(() => stub()),
        union: vi.fn(() => stub()),
        const: vi.fn(() => stub()),
        array: vi.fn(() => stub()),
        string: vi.fn(() => stub()),
        number: vi.fn(() => stub()),
        boolean: vi.fn(() => stub()),
        any: vi.fn(() => stub()),
        dict: vi.fn(() => stub()),
    };
    // biome-ignore lint/style/useNamingConvention: 键名须与 koishi 模块导出名一致
    return { Schema, Time: { second: 1000, minute: 60_000, hour: 3_600_000 } };
});

// 子配置块与 i18n 文案与被测逻辑无关,mock 掉以收窄导入面。
// biome-ignore lint/style/useNamingConvention: 键名须与被 mock 模块的导出名一致
vi.mock("../../market/index.js", () => ({ MarketProviderConfig: {} }));
vi.mock("../../locales/generated.js", () => ({ schemaZh: {}, schemaEn: {} }));

import { Config, configPatchKeys, configReloadKeys, normalizeMarketSilentRules } from "../index.js";

describe("config schema 导出", () => {
    it("Config schema 与白名单/热重载键集合可用", () => {
        expect(Config).toBeTypeOf("object");
        expect(configPatchKeys).not.toContain("registry" as never);
        expect(configReloadKeys.has("idleProbe")).toBe(true);
        expect(configPatchKeys).toContain("bulkMode");
    });
});

describe("normalizeMarketSilentRules", () => {
    it("非数组输入归一为空数组", () => {
        expect(normalizeMarketSilentRules(undefined)).toEqual([]);
        expect(normalizeMarketSilentRules(null)).toEqual([]);
        expect(normalizeMarketSilentRules("preview")).toEqual([]);
        expect(normalizeMarketSilentRules({})).toEqual([]);
    });

    it("过滤非对象元素（null / 基础类型）", () => {
        expect(normalizeMarketSilentRules([null, 1, "x", false])).toEqual([]);
    });

    it("新形态规则保留 type/note,enabled 缺省为 true", () => {
        expect(normalizeMarketSilentRules([{ type: "preview", value: "" }])).toEqual([
            { value: "", enabled: true, type: "preview" },
        ]);
        expect(
            normalizeMarketSilentRules([{ type: "custom", value: "v", note: "n", enabled: false }]),
        ).toEqual([{ value: "v", enabled: false, type: "custom", note: "n" }]);
    });

    it("undefined 的 type/note 不落入结果（键缺省而非置 undefined 值）", () => {
        const [rule] = normalizeMarketSilentRules([{ value: "v" }]);
        expect(Object.hasOwn(rule!, "type")).toBe(false);
        expect(Object.hasOwn(rule!, "note")).toBe(false);
    });

    it("value 带 whitespace 时两侧截断", () => {
        expect(normalizeMarketSilentRules([{ value: "  2024-01-01  " }])[0]!.value).toBe(
            "2024-01-01",
        );
    });

    it("旧版形态按 value → date → days → query 顺序回退", () => {
        // 新形态 value 优先于旧字段
        expect(
            normalizeMarketSilentRules([
                { value: "v", date: "2024-01-01", days: 30, query: "q" },
            ])[0]!.value,
        ).toBe("v");
        expect(normalizeMarketSilentRules([{ date: " 2024-01-01 " }])[0]!.value).toBe("2024-01-01");
        expect(normalizeMarketSilentRules([{ days: 30 }])[0]!.value).toBe("30");
        // days = 0 是合法旧值（!= null 判定）,不应落空
        expect(normalizeMarketSilentRules([{ days: 0 }])[0]!.value).toBe("0");
        expect(normalizeMarketSilentRules([{ query: "category:adapter" }])[0]!.value).toBe(
            "category:adapter",
        );
        // 全部缺省时值为空串
        expect(normalizeMarketSilentRules([{ type: "insecure" }])[0]!.value).toBe("");
        // date/days 为空串或 null 时不截断成空串占位,继续向后回退
        expect(normalizeMarketSilentRules([{ date: "", days: null, query: "q" }])[0]!.value).toBe(
            "q",
        );
    });
});
