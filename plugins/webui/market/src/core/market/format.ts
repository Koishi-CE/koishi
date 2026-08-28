/**
 * 市场展示格式化：把性能快照压成单行 `key=value, ...` 日志串。
 *
 * 被 source/collect.ts（索引就绪日志）与 source/background.ts（后台刷新完成日志）消费；
 * 字段缺失时以 "-" / "unknown" 兜底，保证日志行结构稳定、可 grep。
 * 放在 market 模块内而非 utils/format，因为它绑定了市场性能快照的专有字段组合。
 */
import type { MarketPerformanceSnapshot } from "../../shared/types.js";
import { formatBytes, formatTime, formatTimings } from "../utils/format.js";

/** 把性能快照格式化为单行日志串：size/wireSize 走 formatBytes，时间戳走 formatTime。 */
export function formatSnapshot(snapshot: MarketPerformanceSnapshot = {}) {
    return [
        `source=${snapshot.source ?? "unknown"}`,
        `endpoint=${snapshot.endpoint ?? "unknown"}`,
        `preferred=${snapshot.preferredEndpoint ?? "-"}`,
        `fallback=${snapshot.fallbackReason ?? "-"}`,
        `candidates=${snapshot.candidates ?? "-"}`,
        `objects=${snapshot.objects ?? "-"}`,
        `size=${formatBytes(snapshot.size)}`,
        `wireSize=${formatBytes(snapshot.wireSize)}`,
        `encoding=${snapshot.contentEncoding ?? "identity"}`,
        `cachedAt=${formatTime(snapshot.cachedAt)}`,
        `validatedAt=${formatTime(snapshot.validatedAt)}`,
        `timings=${formatTimings(snapshot.timings) || "-"}`,
    ].join(", ");
}
