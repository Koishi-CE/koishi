/**
 * @file market-next 数据文件内容的防御性归一化（market 域）。
 *
 * 模块职责:normalizeStore/normalizeDict/isRecord 三个纯防御函数——文件
 * 损坏或字段类型不符时回退空 dict 而非抛错,保证脏数据不进内存。
 *
 * 消费方:data-store.ts 的加载/patch、migrate.ts 的 collapsedGroups 清理。
 */
import type { Dict } from "@koishi-ce/koishi";
import type { MarketDataStorePayload } from "./data-store.js";

/** 防御性归一化文件内容:非对象或缺字段一律回退空 dict,损坏数据不进内存。 */
export function normalizeStore(value: unknown): MarketDataStorePayload {
	const record = isRecord(value) ? value : {};
	return {
		override: normalizeDict(record["override"]),
		updateIgnored: normalizeDict(record["updateIgnored"]),
		bundleRecords: normalizeDict(record["bundleRecords"]),
		collapsedGroups: normalizeDict<boolean>(record["collapsedGroups"]),
	};
}

/** dict 归一化:非对象回退空 dict,对象则浅拷贝(与外部引用脱钩)。 */
export function normalizeDict<T = unknown>(value: unknown): Dict<T> {
	if (!isRecord(value)) return {};
	return { ...(value as Dict<T>) };
}

/** 纯对象判定(null、数组都排除)。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
