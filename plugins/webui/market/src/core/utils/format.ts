/**
 * @file 展示格式化小工具(core/utils 域):错误信息、hash 缩写、时间/时长/字节
 * 的人类可读格式,以及 HTTP content-length 解析等。全部为纯函数,无 I/O、无状态。
 *
 * 架构位置:core 领域层的公共工具,主要被 market/source(拉取日志与统计)、
 * market/cache(warmup 日志)与 registry 等域消费,用于日志与调试输出。
 */

/** 把 unknown 异常压成一行可写进日志/报告的字符串:Error 取 message,其余 String()。 */
export function formatError(error: unknown) {
    if (error instanceof Error) return error.message;
    return String(error);
}

/** 类似 formatError,但优先取完整 stack(无 stack 时回退 message),用于详细诊断日志。 */
export function formatStack(error: unknown) {
    if (error instanceof Error) return error.stack || error.message;
    return String(error);
}

/** 取 hash 前 12 位用于日志展示:足以辨识版本又不会刷屏。 */
export function shortHash(hash?: string) {
    return hash?.slice(0, 12);
}

/** 时间戳转 ISO 字符串;0/undefined 统一显示 "-"(缺失与无效不加区分)。 */
export function formatTime(value?: number) {
    if (!value) return "-";
    return new Date(value).toISOString();
}

/** 毫秒时长转人类可读(如 "3s"、"2m"、"1h"、"4d");null/Infinity/NaN 显示 "-"。 */
export function formatAge(age?: number) {
    if (age == null || !Number.isFinite(age)) return "-";
    if (age < 1000) return `${Math.max(0, Math.round(age))}ms`;
    if (age < 60_000) return `${Math.round(age / 1000)}s`;
    if (age < 3_600_000) return `${Math.round(age / 60_000)}m`;
    if (age < 86_400_000) return `${Math.round(age / 3_600_000)}h`;
    return `${Math.round(age / 86_400_000)}d`;
}

/** 字节数转人类可读(如 "12.3MB");null/非有限值显示 "-"。 */
export function formatBytes(value?: number) {
    if (value == null || !Number.isFinite(value)) return "-";
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)}MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)}KB`;
    return `${Math.round(value)}B`;
}

/** 解析 HTTP content-length 头:空值/非数字/负数一律返回 undefined 而非 NaN。 */
export function parseContentLength(value?: string | null) {
    if (!value) return undefined;
    const size = Number(value);
    return Number.isFinite(size) && size >= 0 ? size : undefined;
}

/**
 * 校正传输字节数:头里没有 content-length(为 0/undefined)但实际解出了响应体时,
 * 返回 undefined 表示"wire size 未知"。gzip 传输常见此情况,报 0 会误导流量统计。
 *
 * @param wireSize 响应头声明的字节数(可能缺失)
 * @param decodedSize 实际解码得到的字节数
 */
export function normalizeWireSize(wireSize: number | undefined, decodedSize: number) {
    if (!wireSize && decodedSize > 0) return undefined;
    return wireSize;
}

/** 把耗时表压成 "key1=12ms, key2=3ms" 形式,用于单行日志汇总各阶段耗时。 */
export function formatTimings(timings: Record<string, number> = {}) {
    return Object.entries(timings)
        .map(([key, value]) => `${key}=${Math.round(value)}ms`)
        .join(", ");
}

/** 从 endpoint URL 提取 host 用于日志展示;解析失败(非 URL 形态)原样返回。 */
export function formatEndpointHost(endpoint: string) {
    try {
        return new URL(endpoint).host;
    } catch {
        return endpoint;
    }
}
