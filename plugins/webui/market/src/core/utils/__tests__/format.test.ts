import { describe, expect, it } from "vitest";
import {
    formatAge,
    formatBytes,
    formatEndpointHost,
    formatError,
    formatStack,
    formatTime,
    formatTimings,
    normalizeWireSize,
    parseContentLength,
    shortHash,
} from "../format.js";

describe("formatAge", () => {
    it("空值与非有限值返回 -", () => {
        expect(formatAge(undefined)).toBe("-");
        expect(formatAge(Number.NaN)).toBe("-");
    });

    it("按量级取整为 ms/s/m/h/d", () => {
        expect(formatAge(500)).toBe("500ms");
        expect(formatAge(-5)).toBe("0ms");
        expect(formatAge(5000)).toBe("5s");
        expect(formatAge(90_000)).toBe("2m");
        expect(formatAge(7_200_000)).toBe("2h");
        expect(formatAge(2 * 86_400_000)).toBe("2d");
    });
});

describe("formatBytes", () => {
    it("空值与非法值返回 -", () => {
        expect(formatBytes(undefined)).toBe("-");
        expect(formatBytes(Number.NaN)).toBe("-");
    });

    it("按大小输出 B/KB/MB", () => {
        expect(formatBytes(500)).toBe("500B");
        expect(formatBytes(2048)).toBe("2.0KB");
        expect(formatBytes(5 * 1024 * 1024)).toBe("5.00MB");
    });
});

describe("parseContentLength / normalizeWireSize", () => {
    it("parseContentLength 仅接受非负有限数", () => {
        expect(parseContentLength(undefined)).toBeUndefined();
        expect(parseContentLength(null)).toBeUndefined();
        expect(parseContentLength("")).toBeUndefined();
        expect(parseContentLength("123")).toBe(123);
        expect(parseContentLength("abc")).toBeUndefined();
        expect(parseContentLength("-5")).toBeUndefined();
    });

    it("normalizeWireSize 缺失 wireSize 时返回 undefined", () => {
        expect(normalizeWireSize(undefined, 10)).toBeUndefined();
        expect(normalizeWireSize(0, 10)).toBeUndefined();
        expect(normalizeWireSize(5, 10)).toBe(5);
    });
});

describe("短 hash 与时间格式化", () => {
    it("shortHash 取前 12 位", () => {
        expect(shortHash("abcdefghijklmnop")).toBe("abcdefghijkl");
        expect(shortHash(undefined)).toBeUndefined();
    });

    it("formatTime 输出 ISO 或 -", () => {
        expect(formatTime(undefined)).toBe("-");
        expect(formatTime(0)).toBe("-");
        expect(formatTime(Date.parse("2026-01-01T00:00:00Z"))).toBe("2026-01-01T00:00:00.000Z");
    });

    it("formatTimings 按键值拼接", () => {
        expect(formatTimings({})).toBe("");
        expect(formatTimings({ a: 1.4, b: 2.6 })).toBe("a=1ms, b=3ms");
    });
});

describe("端点与错误格式化", () => {
    it("formatEndpointHost 取 URL host 或原样返回", () => {
        expect(formatEndpointHost("https://registry.koishi.chat/index.json")).toBe(
            "registry.koishi.chat",
        );
        expect(formatEndpointHost("not a url")).toBe("not a url");
    });

    it("formatError / formatStack", () => {
        expect(formatError(new Error("boom"))).toBe("boom");
        expect(formatError("boom")).toBe("boom");
        expect(formatError(42)).toBe("42");
        expect(formatStack("boom")).toBe("boom");
        const error = new Error("boom");
        expect(formatStack(error)).toContain("Error: boom");
    });
});
