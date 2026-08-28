/**
 * @file 数值小工具(core/utils 域):clamp 夹取与安全的数值转换。纯函数,无 I/O。
 */

/** 把 value 限制在 [min, max] 区间内(越界取边界),用于并发数/超时等配置兜底。 */
export function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

/** 宽容地把 unknown 转成有限数:NaN/Infinity/不可解析值返回 undefined 而非抛错。 */
export function finiteNumber(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}
