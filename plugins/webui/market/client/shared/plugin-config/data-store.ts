/**
 * @file market-next 前端数据仓(store.marketData)读写层(shared/plugin-config 域)。
 *
 * store.marketData 是本插件私有的前端数据(待应用 override、更新忽略记录、
 * 合包记录、折叠分组),由服务端持久化回发。缺失时落到本地 reactive 兜底
 * 对象,保证任何读取都有返回;写入走"本地立即合并 + RPC 同步服务端"双写。
 */

import { send, store } from "@koishi-ce/client";
import { reactive } from "vue";
import type { IgnoredUpdates } from "../../../src/shared/update";

/** 本插件在前端的数据仓(store.marketData)形态,由服务端持久化回发。 */
export interface MarketNextDataStore {
	/** 待应用的依赖变更:包名 → 版本请求(空串表示待卸载)。 */
	override?: Record<string, string>;
	/** 各包的更新忽略规则。 */
	updateIgnored?: IgnoredUpdates;
	/** 合包安装记录。 */
	bundleRecords?: Record<string, any>;
	/** 依赖页各分组的折叠状态。 */
	collapsedGroups?: Record<string, boolean>;
}

/** store.marketData 缺失时的本地兜底仓(非持久化,仅保证读取不空)。 */
const fallbackMarketData = reactive<MarketNextDataStore>({
	override: {},
	updateIgnored: {},
	bundleRecords: {},
	collapsedGroups: {},
});

/** 取本插件的数据仓:优先 store.marketData(服务端已推送),否则就地初始化。仅供本域子模块共享。 */
export function getMarketDataStore(): MarketNextDataStore {
	return ((store as any).marketData ||= fallbackMarketData);
}

/** 待应用的依赖 override 表:包名 → 版本请求('' 表示待卸载)。 */
export function getPendingOverrides() {
	const data = getMarketDataStore();
	data.override ||= {};
	return data.override;
}

/** 依赖页分组的折叠状态表:分组 key → 是否折叠。 */
export function getCollapsedGroups() {
	const data = getMarketDataStore();
	data.collapsedGroups ||= {};
	return data.collapsedGroups;
}

/** 合包安装记录(只读视图;数据仓缺失时返回空对象)。 */
export function getBundleRecords(fallback?: {
	market?: { bundleRecords?: Record<string, any> };
}) {
	return getMarketDataStore().bundleRecords ?? {};
}

/** 合包安装记录的可写引用(直接改它再 patchMarketNextData 持久化)。 */
export function getWritableBundleRecords(fallback?: {
	market?: { bundleRecords?: Record<string, any> };
}) {
	const data = getMarketDataStore();
	data.bundleRecords ||= {};
	return data.bundleRecords;
}

/**
 * 更新前端数据仓:本地立即合并,再发 market/update-data RPC;服务端会
 * 返回规整后的完整数据(含其他标签页的写入),回填本地保证多端一致。
 */
export function patchMarketNextData(patch: Partial<MarketNextDataStore>) {
	const data = getMarketDataStore();
	Object.assign(data, patch);
	const task = send("market/update-data", patch);
	if (!task) return Promise.resolve(false);
	return task
		.then((next: MarketNextDataStore) => {
			Object.assign(data, next);
			return true;
		})
		.catch((error) => {
			console.error(error);
			return false;
		});
}
