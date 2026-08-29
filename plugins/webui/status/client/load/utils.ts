/** 将 0~1 的比率格式化为百分比字符串，digits 为保留的小数位数（默认 3 位）。 */
export function percentage(value: number, digits = 3) {
	return `${(value * 100).toFixed(digits)}%`;
}
