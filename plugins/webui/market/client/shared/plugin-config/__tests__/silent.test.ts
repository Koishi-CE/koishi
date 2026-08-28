import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * @file silent.ts 的单元测试:三代静默过滤配置形态的读取优先级与
 * 规则到查询词的转换矩阵(状态/日期/近期/自定义/扁平规则,含非法值丢弃)。
 */

vi.mock("@koishi-ce/client", async () => {
    const { createKoishiClientStub } = await import("../../__tests__/helpers");
    return createKoishiClientStub();
});

const { store } = await import("@koishi-ce/client");
const { getMarketSilentFilters, getMarketSilentRules } = await import("../silent");

/** 布置插件配置节点的 market 子树。 */
function setupMarketConfig(market: any) {
    store.config = { plugins: { "market-next": market } };
}

beforeEach(() => {
    store.config = {};
});

describe("配置形态优先级", () => {
    it("三者都没配置时返回空串/空数组", () => {
        setupMarketConfig({});
        expect(getMarketSilentFilters()).toBe("");
        expect(getMarketSilentRules()).toEqual([]);
    });

    it("原始字符串 marketSilentFilters 原样返回", () => {
        setupMarketConfig({ marketSilentFilters: "is:preview\nkeyword" });
        expect(getMarketSilentFilters()).toBe("is:preview\nkeyword");
        expect(getMarketSilentRules()).toEqual([]);
    });

    it("扁平规则 marketSilentRules 优先于四组结构化规则与原始字符串", () => {
        setupMarketConfig({
            marketSilentRules: [{ type: "bundle" }],
            marketSilentStatusRules: [{ target: "preview" }],
            marketSilentFilters: "stale",
        });
        expect(getMarketSilentFilters()).toBe("is:bundle");
        expect(getMarketSilentRules()).toEqual(["is:bundle"]);
    });

    it("marketSilentRules 存在但非数组时按空规则处理", () => {
        setupMarketConfig({ marketSilentRules: "broken", marketSilentFilters: "stale" });
        expect(getMarketSilentFilters()).toBe("");
    });

    it("四组结构化规则优先于原始字符串", () => {
        setupMarketConfig({
            marketSilentStatusRules: [{ target: "insecure" }],
            marketSilentFilters: "stale",
        });
        expect(getMarketSilentFilters()).toBe("is:insecure");
    });
});

describe("扁平规则转换(marketSilentRules)", () => {
    it.each([
        [{ type: "preview" }, "is:preview"],
        [{ type: "insecure" }, "is:insecure"],
        [{ type: "bundle" }, "is:bundle"],
        [{ type: "created-before", date: "2020-01-02" }, "created:<2020-01-02"],
        [{ type: "created-after", date: "2020-01-02" }, "created:>2020-01-02"],
        [{ type: "updated-before", date: "2021-03-04" }, "updated:<2021-03-04"],
        [{ type: "updated-after", date: "2021-03-04" }, "updated:>2021-03-04"],
        [{ type: "created-within", days: 30 }, "created:within:30"],
        [{ type: "updated-within", days: 7 }, "updated:within:7"],
        [{ type: "custom", query: "chatbot" }, "chatbot"],
    ])("%j → %s", (rule, expected) => {
        setupMarketConfig({ marketSilentRules: [rule] });
        expect(getMarketSilentRules()).toEqual([expected]);
    });

    it("date 与 days 缺省时从 value 字段兜底", () => {
        setupMarketConfig({
            marketSilentRules: [
                { type: "created-before", value: "2019-12-31" },
                { type: "created-within", value: "14" },
            ],
        });
        expect(getMarketSilentRules()).toEqual(["created:<2019-12-31", "created:within:14"]);
    });

    it("非法日期/天数/空查询的规则被丢弃,enabled=false 的规则被丢弃", () => {
        setupMarketConfig({
            marketSilentRules: [
                { type: "created-before", date: "2020/01/02" },
                { type: "created-before", date: "" },
                { type: "created-within", days: 0 },
                { type: "created-within", days: -3 },
                { type: "updated-within", days: 1.5 },
                { type: "custom", query: "   " },
                { type: "preview", enabled: false },
                { type: "custom", enabled: false },
                { type: "unknown-type", query: "kept-as-custom" },
            ],
        });
        expect(getMarketSilentRules()).toEqual(["kept-as-custom"]);
    });

    it("多行字符串由 getMarketSilentFilters 用换行拼接", () => {
        setupMarketConfig({
            marketSilentRules: [
                { type: "preview" },
                { type: "created-before", date: "2020-01-01" },
            ],
        });
        expect(getMarketSilentFilters()).toBe("is:preview\ncreated:<2020-01-01");
    });
});

describe("四组结构化规则转换", () => {
    it("状态规则:enabled=false 或缺 target 的丢弃", () => {
        setupMarketConfig({
            marketSilentStatusRules: [
                { target: "preview" },
                { target: "insecure", enabled: false },
                { enabled: true },
                { target: "bundle", note: "带备注" },
            ],
        });
        expect(getMarketSilentRules()).toEqual(["is:preview", "is:bundle"]);
    });

    it("日期规则:缺 field/relation 或日期非法的丢弃,before/after 分别映射", () => {
        setupMarketConfig({
            marketSilentDateRules: [
                { field: "created", relation: "before", date: "2020-01-01" },
                { field: "updated", relation: "after", date: "2021-06-30" },
                { field: "created", relation: "before", date: "not-a-date" },
                { field: "created", relation: "before" },
                { relation: "before", date: "2020-01-01" },
                { field: "created", date: "2020-01-01", enabled: false },
            ],
        });
        expect(getMarketSilentRules()).toEqual(["created:<2020-01-01", "updated:>2021-06-30"]);
    });

    it("近期规则:days 非有限或非正数的丢弃,小数向下取整", () => {
        setupMarketConfig({
            marketSilentRecentRules: [
                { field: "created", days: 30 },
                { field: "updated", days: 7.9 },
                { field: "created", days: 0 },
                { field: "created", days: -1 },
                { field: "created", days: Number.NaN },
                { field: "created" },
                { field: "created", days: 5, enabled: false },
            ],
        });
        expect(getMarketSilentRules()).toEqual(["created:within:30", "updated:within:7"]);
    });

    it("自定义规则:去空白后为空的丢弃", () => {
        setupMarketConfig({
            marketSilentCustomRules: [{ query: "  chatbot  " }, { query: "" }, { enabled: false }],
        });
        expect(getMarketSilentRules()).toEqual(["chatbot"]);
    });

    it("四组规则合并输出且保持组间顺序", () => {
        setupMarketConfig({
            marketSilentStatusRules: [{ target: "preview" }],
            marketSilentDateRules: [{ field: "created", relation: "after", date: "2020-01-01" }],
            marketSilentRecentRules: [{ field: "updated", days: 3 }],
            marketSilentCustomRules: [{ query: "bot" }],
        });
        expect(getMarketSilentRules()).toEqual([
            "is:preview",
            "created:>2020-01-01",
            "updated:within:3",
            "bot",
        ]);
    });

    it("只有某组为空数组时视为未配置,不影响其他组", () => {
        setupMarketConfig({
            marketSilentStatusRules: [],
            marketSilentCustomRules: [{ query: "bot" }],
        });
        expect(getMarketSilentRules()).toEqual(["bot"]);
    });
});
