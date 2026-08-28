/**
 * @file 市场页调试面板的纯格式化函数(market 页域)。
 *
 * 体积/耗时/评分/编码/枚举翻译等展示格式化,t 由调用方注入,可独立单测。
 */

import { endpointHost } from "../../shared/format";

export type Translate = (key: string, args?: any) => string;

/** 时间戳 → 本地化时间串。 */
export function formatTime(value: number, locale: string) {
	return new Date(value).toLocaleString(locale);
}

/** 数据来源的网络/磁盘缓存/304/哈希缓存/legacy 枚举翻译。 */
export function formatSource(source: string | undefined, t: Translate) {
	const labels: Record<string, string> = {
		network: t("marketPage.debug.sourceNetwork"),
		"disk-cache": t("marketPage.debug.sourceDiskCache"),
		"http-304": t("marketPage.debug.sourceHttp304"),
		"hash-cache": t("marketPage.debug.sourceHashCache"),
		legacy: t("marketPage.debug.sourceLegacy"),
	};
	return source ? labels[source] || source : t("marketPage.debug.unknown");
}

/** 耗时项 key → 本地化名称(请求/版本探测/解析/前后端各阶段)。 */
export function formatTimingName(name: string, t: Translate) {
	const labels: Record<string, string> = {
		request: t("marketPage.debug.request"),
		version: t("marketPage.debug.versionProbe"),
		hash: "Hash",
		parse: t("marketPage.debug.parse"),
		apply: t("marketPage.debug.apply"),
		total: t("marketPage.debug.total"),
		cacheRead: t("marketPage.debug.cacheRead"),
		cacheParse: t("marketPage.debug.cacheParse"),
		payloadData: t("marketPage.debug.payloadData"),
		payload: t("marketPage.debug.payload"),
		frontendSort: t("marketPage.debug.frontendSort"),
		frontendFilter: t("marketPage.debug.frontendFilter"),
		frontendVirtual: t("marketPage.debug.frontendVirtual"),
	};
	return labels[name] || name;
}

/** 毫秒数 → "Nms"。 */
export function formatDuration(value: number) {
	return `${Math.round(value)}ms`;
}

/** 阶段概览:来源/端点/回退原因/总耗时/编码/体积拼接成一行。 */
export function formatDebugPhase(
	value: {
		source?: string;
		endpoint?: string;
		timings?: Record<string, number>;
		contentEncoding?: string;
		wireSize?: number;
		fallbackReason?: string;
	},
	t: Translate,
) {
	const parts = [formatSource(value.source, t), shortEndpoint(value.endpoint)];
	if (value.fallbackReason)
		parts.push(formatFallbackReason(value.fallbackReason, t));
	if (value.timings?.total != null)
		parts.push(formatDuration(value.timings.total));
	if (value.contentEncoding) parts.push(value.contentEncoding);
	if (value.wireSize) parts.push(formatSize(value.wireSize));
	return parts.filter(Boolean).join(" / ");
}

/** 端点回退原因枚举翻译。 */
export function formatFallbackReason(value: string | undefined, t: Translate) {
	switch (value) {
		case "primary-failed":
			return t("marketPage.debug.primaryFailed");
		case "primary-slow":
			return t("marketPage.debug.primarySlow");
		case "primary-stale":
			return t("marketPage.debug.primaryStale");
		case "rescue":
			return t("marketPage.debug.rescue");
		default:
			return "-";
	}
}

/** 字节数 → B/KB/MB 文案。 */
export function formatSize(value?: number) {
	if (value == null) return "-";
	if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)}MB`;
	if (value > 1024) return `${(value / 1024).toFixed(1)}KB`;
	return `${value}B`;
}

/** 内容编码展示,缺省 identity(未压缩)。 */
export function formatEncoding(value?: string) {
	return value || "identity";
}

/** 压缩比:解码体积/传输体积;未压缩时显示占位文案。 */
export function formatCompressionRatio(
	decoded: number | undefined,
	encoded: number | undefined,
	t: Translate,
) {
	if (!decoded || !encoded) return "-";
	if (encoded >= decoded) return t("marketPage.debug.uncompressed");
	return `${(decoded / encoded).toFixed(1)}x`;
}

/** 端点 URL → 只显示 host(解析失败原样返回);统一用 shared/format 口径。 */
export function shortEndpoint(value?: string) {
	if (!value) return "-";
	return endpointHost(value);
}

/** 端点评分 → 一位小数文本。 */
export function formatScore(value?: number) {
	return value == null ? "-" : value.toFixed(1);
}

/** 数字 → 千分位文本(空值显示 -)。 */
export function formatNumber(value?: number) {
	return value == null ? "-" : value.toLocaleString();
}
