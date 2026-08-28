/**
 * @file registry 元数据获取过程中的状态上报辅助(core/registry/client 域)。
 *
 * 从 fetch.ts 拆出的 report 系列:reportLoadingStatus(进入 loading 态的
 * 首次上报)与 reportFetchFailure(最终失败收口)。后者会把汇总的
 * reason(s) 以不可枚举属性挂到异常对象上,供上层(deps/resolver 的 404
 * 归类等)读取而不用改异常类型。
 *
 * 架构位置:被 fetch.ts 的获取主循环调用,宿主能力面经 RegistryFetchHost
 * (fetch.ts 定义)访问。
 */
import { mergeFailureDetail, type RegistryReason } from "../errors.js";
import type { RegistryFetchHost } from "./fetch.js";

/** 上报 loading 状态。 */
export function reportLoadingStatus(
    name: string,
    endpoint: string,
    attempts: number,
    serial: number,
    host: RegistryFetchHost,
) {
    host.statusSink(
        name,
        {
            loading: true,
            error: undefined,
            reason: undefined,
            endpoint,
            attempts,
            elapsed: undefined,
        },
        serial,
    );
}

/**
 * 最终失败收口:合并全部失败归因上报状态,并把汇总的 reason(s)
 * 以不可枚举属性挂到异常对象上,供上层(deps/resolver 的 404 归类等)
 * 读取而不用改异常类型。
 */
export function reportFetchFailure(
    name: string,
    lastError: unknown,
    failureReasons: RegistryReason[],
    lastEndpoint: string,
    attempts: number,
    start: number,
    host: RegistryFetchHost,
) {
    const detail = host.formatError(lastError);
    const finalDetail = mergeFailureDetail(detail, failureReasons);
    host.statusSink(
        name,
        {
            loading: false,
            reason: finalDetail.reason,
            error: finalDetail.error,
            endpoint: lastEndpoint,
            attempts,
            elapsed: Date.now() - start,
        },
        host.scope.current,
    );
    host.log.warn(`failed to fetch registry metadata for ${name}: ${detail.error}`);
    if (lastError && typeof lastError === "object") {
        Object.defineProperty(lastError, "marketNextReason", {
            value: finalDetail.reason,
            configurable: true,
        });
        Object.defineProperty(lastError, "marketNextReasons", {
            value: failureReasons,
            configurable: true,
        });
    }
}
