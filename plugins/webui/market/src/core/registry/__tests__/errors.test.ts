import { describe, expect, it } from "vitest";
import {
    attachRegistryAttemptReasons,
    formatRegistryError,
    mergeFailureDetail,
    registryFailurePenalty,
} from "../errors.js";

function httpError(status?: number, message = "Request failed") {
    const error = new Error(message) as Error & { response?: { status?: number } };
    if (status !== undefined) error.response = { status };
    return error;
}

describe("formatRegistryError", () => {
    it("透传挂载的 marketNextReason", () => {
        const error = new Error("boom") as Error & { marketNextReason?: string };
        error.marketNextReason = "timeout";
        expect(formatRegistryError(error, () => false)).toEqual({
            reason: "timeout",
            error: "boom",
        });
    });

    it("HTTP 404 → not-found，其余状态 → http", () => {
        expect(formatRegistryError(httpError(404), () => true)).toEqual({
            reason: "not-found",
            error: "npm 元数据不存在，或当前镜像尚未同步该包。",
        });
        expect(formatRegistryError(httpError(500), () => true).reason).toBe("http");
    });

    it("按消息分类超时/网络/格式/未知", () => {
        expect(formatRegistryError(new Error("request timeout"), () => false).reason).toBe(
            "timeout",
        );
        expect(formatRegistryError(new Error("socket hang up ENOTFOUND"), () => false).reason).toBe(
            "network",
        );
        expect(
            formatRegistryError(new Error("invalid registry metadata"), () => false).reason,
        ).toBe("invalid");
        expect(formatRegistryError(new Error("boom"), () => false).reason).toBe("unknown");
    });

    it("非 Error 值转为字符串", () => {
        expect(formatRegistryError("oops", () => false)).toEqual({
            reason: "unknown",
            error: "oops",
        });
    });

    it("isHttpError 无 status 时回退消息判定", () => {
        expect(formatRegistryError(httpError(undefined, "boom"), () => true).reason).toBe(
            "unknown",
        );
    });

    it("空 message 的未知错误回退默认文案", () => {
        expect(formatRegistryError(new Error(""), () => false)).toEqual({
            reason: "unknown",
            error: "npm 元数据请求失败。",
        });
    });

    it("marketNextReason 挂在非 Error 对象上时消息取字符串化结果", () => {
        const error = { marketNextReason: "timeout" } as { marketNextReason: string };
        expect(formatRegistryError(error, () => false)).toEqual({
            reason: "timeout",
            error: String(error),
        });
    });
});

describe("attachRegistryAttemptReasons", () => {
    it("挂载到对象错误上", () => {
        const error = new Error("x");
        attachRegistryAttemptReasons(error, ["timeout", "not-found"]);
        expect((error as { marketNextReasons?: string[] }).marketNextReasons).toEqual([
            "timeout",
            "not-found",
        ]);
    });

    it("非对象错误静默跳过", () => {
        expect(() => attachRegistryAttemptReasons("x", ["timeout"])).not.toThrow();
    });
});

describe("mergeFailureDetail", () => {
    const detail = { reason: "unknown", error: "boom" } as const;

    it("全部 not-found 时保持原 detail", () => {
        expect(mergeFailureDetail(detail, ["not-found", "not-found"])).toEqual(detail);
    });

    it("存在非 not-found 原因时取首个", () => {
        expect(mergeFailureDetail(detail, ["not-found", "timeout", "network"])).toEqual({
            reason: "timeout",
            error: "boom",
        });
    });

    it("无失败原因时保持原 detail", () => {
        expect(mergeFailureDetail(detail, [])).toEqual(detail);
    });
});

describe("registryFailurePenalty", () => {
    it("差异化扣分", () => {
        expect(registryFailurePenalty("not-found")).toBe(0.4);
        expect(registryFailurePenalty("invalid")).toBe(0.8);
        expect(registryFailurePenalty("http")).toBe(1.2);
        expect(registryFailurePenalty("timeout")).toBe(1.8);
        expect(registryFailurePenalty("network")).toBe(1.8);
        expect(registryFailurePenalty(undefined)).toBe(1.5);
        expect(registryFailurePenalty("unknown")).toBe(1.5);
    });
});
