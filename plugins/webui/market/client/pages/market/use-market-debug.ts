/**
 * @file 市场页调试面板数据 composable(market 页域)。
 *
 * 汇总服务端 debug 快照(对象数/体积/编码/压缩比/端点评分)与列表组件
 * 上报的前端统计(过滤/排序/虚拟化耗时)为面板键值对条目。
 */

import { computed, ref } from "vue";
import { store } from "@koishi-ce/client";
import {
	formatCompressionRatio,
	formatDebugPhase,
	formatEncoding,
	formatFallbackReason,
	formatNumber,
	formatSize,
	formatTime,
	type Translate,
} from "./debug-format";

export function useMarketDebug(t: Translate, locale: { value: string }) {
	/** 列表组件上报的前端调试统计(过滤/排序/虚拟化耗时)。 */
	const clientDebug = ref<{
		timings?: Record<string, number>;
		total?: number;
		matched?: number;
		visible?: number;
		rendered?: number;
	}>({});

	/** 调试面板的键值对条目(对象数/体积/编码/压缩比/端点/前后端统计)。 */
	// 数据字面量条目表:逐行三元与空值兜底是数据构造,非控制流分派,拆分无收益
	// fallow-ignore-next-line complexity
	const debugItems = computed(() => {
		const debug = store.market?.debug;
		if (!debug) return [];
		return [
			[
				t("marketPage.debug.objectCount"),
				formatNumber(debug.objects ?? store.market?.total),
			],
			[t("marketPage.debug.decodedSize"), formatSize(debug.size)],
			[t("marketPage.debug.wireSize"), formatSize(debug.wireSize)],
			[t("marketPage.debug.encoding"), formatEncoding(debug.contentEncoding)],
			[
				t("marketPage.debug.compressionRatio"),
				formatCompressionRatio(debug.size, debug.wireSize, t),
			],
			[t("marketPage.debug.candidates"), formatNumber(debug.candidates)],
			[t("marketPage.debug.preferredEndpoint"), debug.preferredEndpoint || "-"],
			[
				t("marketPage.debug.fallbackReason"),
				formatFallbackReason(debug.fallbackReason, t),
			],
			["Hash", debug.hash || "-"],
			["ETag", debug.etag || "-"],
			["Last-Modified", debug.lastModified || "-"],
			[
				t("marketPage.debug.cacheTime"),
				debug.cachedAt ? formatTime(debug.cachedAt, locale.value) : "-",
			],
			[
				t("marketPage.debug.validationTime"),
				debug.validatedAt ? formatTime(debug.validatedAt, locale.value) : "-",
			],
			[
				t("marketPage.debug.frontendMatched"),
				clientDebug.value.matched == null
					? "-"
					: `${clientDebug.value.matched} / ${clientDebug.value.total ?? "-"}`,
			],
			[
				t("marketPage.debug.loadedRendered"),
				clientDebug.value.visible == null
					? "-"
					: `${clientDebug.value.visible} / ${clientDebug.value.rendered ?? "-"}`,
			],
		].map(([label, value]) => ({ label, value }));
	});

	/** 调试面板的耗时条目(服务端 timings 与前端 clientDebug 合并)。 */
	const debugTimings = computed(() => {
		return Object.entries({
			...(store.market?.debug?.timings ?? {}),
			...(clientDebug.value.timings ?? {}),
		}).filter(([, value]) => typeof value === "number");
	});

	/** 调试面板的阶段概览(首次加载/后台刷新两阶段)。 */
	const debugPhases = computed(() => {
		const debug = store.market?.debug;
		if (!debug) return [];
		return [
			[t("marketPage.debug.initial"), debug.initial],
			[t("marketPage.debug.background"), debug.refresh],
		]
			.filter(([, value]) => value)
			.map(([label, value]) => ({
				label,
				value: formatDebugPhase(value as any, t),
			}));
	});

	/** 端点评分排行(前 6 个候选端点的分数/延迟/缓存状态)。 */
	const debugRoutes = computed(
		() => store.market?.debug?.routeScores?.slice(0, 6) ?? [],
	);

	/** 接收列表组件上报的前端调试统计。 */
	function updateClientDebug(value: typeof clientDebug.value) {
		clientDebug.value = value;
	}

	return {
		clientDebug,
		debugItems,
		debugTimings,
		debugPhases,
		debugRoutes,
		updateClientDebug,
	};
}
