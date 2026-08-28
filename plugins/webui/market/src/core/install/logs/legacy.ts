/**
 * legacy 安装日志解析（core/install/logs 域）。
 *
 * 无 .log.json 元数据（旧版本产生的日志）时，从 .log 文本还原历史条目：
 * 头部字段（startedAt/deps/forced/installEndpoint）+ 完成标记与失败字样
 * 推断状态 + 最后一个时间戳行作为结束时间。
 *
 * 架构位置：自 reader.ts 成块移植（解析纯函数，无 I/O），
 * 由 reader 的元数据缺失回退路径调用。
 */
import { basename } from "node:path";
import type { InstallHistoryEntry, InstallHistoryStatus } from "../types.js";

/** 无元数据时从 .log 文本解析出一条历史记录（legacy 兼容路径）。 */
export function parseLegacyInstallLog(
    id: string,
    content: string,
    size: number,
    activeFile?: string,
): InstallHistoryEntry {
    const fields = parseLegacyFields(content);
    const active = basename(activeFile || "") === id;
    const status = resolveLegacyStatus(content, active);
    const finishedAt = getLegacyFinishedAt(content, status);
    return {
        id,
        startedAt: fields.startedAt,
        finishedAt,
        duration:
            fields.startedAt && finishedAt ? Math.max(0, finishedAt - fields.startedAt) : undefined,
        status,
        deps: fields.deps,
        forced: fields.forced,
        installEndpoint:
            fields.endpoint && fields.endpoint !== "(default)" ? fields.endpoint : undefined,
        size,
        changes: [],
    };
}

/** 提取 legacy 日志头部字段（startedAt/deps/forced/installEndpoint）。 */
function parseLegacyFields(content: string) {
    const field = (name: string) =>
        content.match(new RegExp(`^${name}:\\s*(.*)$`, "m"))?.[1]?.trim();
    return {
        startedAt: Date.parse(field("startedAt") || "") || 0,
        deps: field("deps") || "(unknown)",
        forced: field("forced") === "true",
        endpoint: field("installEndpoint"),
    };
}

/** 从 legacy 文本推断状态：活跃中 → running；有 code 0 收尾 → success；失败标记 → error；否则 unknown。 */
function resolveLegacyStatus(content: string, active: boolean): InstallHistoryStatus {
    if (active) return "running";
    if (/dependency operation finished with code 0\s*$/m.test(content)) return "success";
    if (
        /dependency operation (?:failed|finished with code|ended without)|package manager (?:terminated|failed to start)/m.test(
            content,
        )
    ) {
        return "error";
    }
    return "unknown";
}

/** 取 legacy 文本中最后一个时间戳行作为结束时间（运行中则无）。 */
function getLegacyFinishedAt(content: string, status: InstallHistoryStatus) {
    if (status === "running") return undefined;
    const timestamps = [...content.matchAll(/^\[([^\]]+)\]/gm)];
    return Date.parse(timestamps[timestamps.length - 1]?.[1] || "") || undefined;
}
