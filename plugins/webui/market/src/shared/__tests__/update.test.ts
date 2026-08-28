import { describe, expect, it } from "vitest";
import {
    getLatestAllowedUpdate,
    getUpdateCandidates,
    isUpdateCheckDisabled,
    isUpdateVersionIgnored,
    normalizeUpdateIgnoreCount,
    parseUpdateIgnoredPackages,
} from "../update.ts";

const VERSIONS = ["1.0.0", "1.1.0", "1.2.0", "2.0.0"];

describe("getUpdateCandidates", () => {
    it("返回大于 resolved 的候选并按新到旧排序", () => {
        expect(getUpdateCandidates(VERSIONS, "1.0.0")).toEqual(["2.0.0", "1.2.0", "1.1.0"]);
    });

    it("resolved 缺失或非法时返回空数组", () => {
        expect(getUpdateCandidates(VERSIONS, undefined)).toEqual([]);
        expect(getUpdateCandidates(VERSIONS, "not-a-version")).toEqual([]);
    });

    it("updateIgnorePrerelease 过滤预发布版本", () => {
        expect(
            getUpdateCandidates(["1.0.0", "2.0.0-beta.1"], "1.0.0", {
                updateIgnorePrerelease: true,
            }),
        ).toEqual([]);
    });
});

describe("isUpdateCheckDisabled", () => {
    it("按包名匹配（空白/中英文分隔符、大小写不敏感）", () => {
        const policy = { updateIgnoredPackages: "foo, bar；BAZ" };
        expect(isUpdateCheckDisabled("foo", policy)).toBe(true);
        expect(isUpdateCheckDisabled("Bar", policy)).toBe(true);
        expect(isUpdateCheckDisabled("baz", policy)).toBe(true);
        expect(isUpdateCheckDisabled("qux", policy)).toBe(false);
        expect(isUpdateCheckDisabled("foo", undefined)).toBe(false);
    });
});

describe("isUpdateVersionIgnored", () => {
    it("忽略版本及其列表位置之后的所有候选（移植行为）", () => {
        // candidates: [2.0.0, 1.2.0, 1.1.0]
        const policy = { updateIgnored: { foo: { version: "2.0.0", count: 2 } } };
        expect(isUpdateVersionIgnored("foo", "2.0.0", ["2.0.0", "1.2.0", "1.1.0"], policy)).toBe(
            true,
        );
        expect(isUpdateVersionIgnored("foo", "1.2.0", ["2.0.0", "1.2.0", "1.1.0"], policy)).toBe(
            true,
        );
        expect(isUpdateVersionIgnored("foo", "1.1.0", ["2.0.0", "1.2.0", "1.1.0"], policy)).toBe(
            true,
        );
    });

    it("count 限制被忽略版本上方（更新）的连带忽略数", () => {
        const candidates = ["2.0.0", "1.2.0", "1.1.0"];
        // 忽略 1.1.0（index 2）：与 1.2.0（index 1）相差 1，与 2.0.0（index 0）相差 2
        const count1 = { updateIgnored: { foo: { version: "1.1.0", count: 1 } } };
        expect(isUpdateVersionIgnored("foo", "1.2.0", candidates, count1)).toBe(false);
        expect(isUpdateVersionIgnored("foo", "2.0.0", candidates, count1)).toBe(false);
        const count2 = { updateIgnored: { foo: { version: "1.1.0", count: 2 } } };
        expect(isUpdateVersionIgnored("foo", "1.2.0", candidates, count2)).toBe(true);
        expect(isUpdateVersionIgnored("foo", "2.0.0", candidates, count2)).toBe(false);
        const count3 = { updateIgnored: { foo: { version: "1.1.0", count: 3 } } };
        expect(isUpdateVersionIgnored("foo", "2.0.0", candidates, count3)).toBe(true);
    });

    it("until 过期后忽略规则失效", () => {
        const policy = { updateIgnored: { foo: { version: "2.0.0", until: 1000 } } };
        expect(isUpdateVersionIgnored("foo", "2.0.0", ["2.0.0"], policy, 2000)).toBe(false);
    });
});

describe("getLatestAllowedUpdate", () => {
    it("忽略列表内版本时连带抑制其后的候选（移植行为）", () => {
        const policy = { updateIgnored: { foo: { version: "2.0.0" } } };
        expect(getLatestAllowedUpdate("foo", VERSIONS, "1.0.0", policy)).toBe(undefined);
    });

    it("规则版本不在候选列表时不生效", () => {
        const policy = { updateIgnored: { foo: { version: "9.9.9" } } };
        expect(getLatestAllowedUpdate("foo", VERSIONS, "1.0.0", policy)).toBe("2.0.0");
        expect(getLatestAllowedUpdate("foo", VERSIONS, "1.0.0")).toBe("2.0.0");
    });
});

describe("解析辅助", () => {
    it("normalizeUpdateIgnoreCount 钳制在 1..20", () => {
        expect(normalizeUpdateIgnoreCount(undefined)).toBe(1);
        expect(normalizeUpdateIgnoreCount(0)).toBe(1);
        expect(normalizeUpdateIgnoreCount(99)).toBe(20);
    });

    it("parseUpdateIgnoredPackages 输出规整集合", () => {
        expect(parseUpdateIgnoredPackages(" a, b\n， c ")).toEqual(new Set(["a", "b", "c"]));
    });
});
