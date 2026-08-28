import { allRegistryAttemptsNotFound } from "../../shared/dependency-source.js";
import type { RegistryStatus } from "../../shared/types.js";

export type RegistryReason = NonNullable<RegistryStatus["reason"]>;

export interface RegistryErrorDetail {
    reason: RegistryReason;
    error: string;
}

/**
 * 把任意异常归一为 { reason, error }；marketNextReason 透传优先。
 * isHttpError 由适配层注入（cordis HTTP.Error 判定）。
 */
export function formatRegistryError(
    error: unknown,
    isHttpError: (error: unknown) => boolean,
): RegistryErrorDetail {
    const attached = (error as { marketNextReason?: RegistryReason } | undefined)?.marketNextReason;
    if (attached) {
        return {
            reason: attached,
            error: error instanceof Error ? error.message : String(error),
        };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (isHttpError(error)) {
        const status = (error as { response?: { status?: number } }).response?.status;
        if (status === 404)
            return { reason: "not-found", error: "npm 元数据不存在，或当前镜像尚未同步该包。" };
        if (status) return { reason: "http", error: `npm 元数据请求失败，HTTP ${status}。` };
    }
    if (/timeout|ETIMEDOUT|ECONNABORTED/i.test(message)) {
        return { reason: "timeout", error: "npm 元数据请求超时。" };
    }
    if (/ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed|network/i.test(message)) {
        return { reason: "network", error: "npm 元数据请求网络失败。" };
    }
    if (/invalid registry metadata/i.test(message)) {
        return { reason: "invalid", error: "npm 元数据格式异常。" };
    }
    return { reason: "unknown", error: message || "npm 元数据请求失败。" };
}

/** 把每次尝试的失败原因挂到最终抛出的错误上，供 allRegistryAttemptsNotFound 判定。 */
export function attachRegistryAttemptReasons(error: unknown, reasons: RegistryReason[]) {
    if (!error || typeof error !== "object") return;
    Object.defineProperty(error, "marketNextReasons", {
        value: [...reasons],
        configurable: true,
    });
}

/** 全部尝试失败后的最终归因：全 404 保持 not-found，否则取首个非 404 原因。 */
export function mergeFailureDetail(
    detail: RegistryErrorDetail,
    failureReasons: RegistryReason[],
): RegistryErrorDetail {
    if (allRegistryAttemptsNotFound(failureReasons)) return detail;
    if (failureReasons.some((reason) => reason !== "not-found")) {
        return {
            reason: failureReasons.find((reason) => reason !== "not-found")!,
            error: detail.error,
        };
    }
    return detail;
}

/** 按失败原因的差异化扣分（not-found 多为包不存在，惩罚轻）。 */
export function registryFailurePenalty(reason?: RegistryReason) {
    switch (reason) {
        case "not-found":
            return 0.4;
        case "invalid":
            return 0.8;
        case "http":
            return 1.2;
        case "timeout":
        case "network":
            return 1.8;
        default:
            return 1.5;
    }
}
