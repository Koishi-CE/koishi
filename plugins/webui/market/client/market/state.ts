/**
 * @file 市场快照的 client 侧状态层(market 域)。
 *
 * 维护全量市场快照 marketSnapshot(shallowRef + markRaw:数据量大,避免深
 * 响应式开销),并同步写入 legacy 的 store.market 供旧组件消费。传输协商
 * 优先 http-gzip,失败回退 console 内联;superseded 快照最多重试 3 次。
 * lookup 族拆在 ./lookup.ts,此处聚合 re-export,保持原导出面不变。
 */

import { receive, send, store } from "@koishi-ce/client";
import { markRaw, ref, shallowRef } from "vue";
import type { MarketProvider, MarketSnapshotResponse } from "../../src/shared";
import {
	getSummaryKey,
	isMarketSnapshotTransfer,
	isSnapshotSuperseded,
	type MarketSnapshot,
	resolveMarketSnapshot,
} from "./snapshot-utils";

export {
	getMarketObject,
	getMarketServiceProviders,
	loadMarketObjects,
	loadMarketServiceProviders,
	refreshMarketLookups,
} from "./lookup";

/** 全量市场快照;undefined 表示尚未加载成功。 */
export const marketSnapshot = shallowRef<MarketSnapshot>();
/** 快照加载中标记(驱动页面 loading 态)。 */
export const marketSnapshotLoading = ref(false);
/** 快照加载失败原因(未失败为 undefined)。 */
export const marketSnapshotError = ref<unknown>();

/** 进行中的快照请求(单飞:并发调用复用同一 Promise)。 */
let snapshotTask: Promise<MarketSnapshot> | undefined;
/** 发起快照请求时观察到的 store 摘要 key,用于事后判定是否被新数据取代。 */
let snapshotTaskKey = "";
/** 最近一次成功发布快照的摘要 key。 */
let snapshotKey = "";
/** 哨兵错误:请求期间 store 已被服务端推送的更新数据覆盖。 */
const snapshotSuperseded = new Error("market snapshot superseded");
/** 哨兵错误:superseded 重试超过上限,快照变化过于频繁。 */
const snapshotRetryLimit = new Error("market snapshot changed too frequently");
const MAX_SNAPSHOT_SUPERSEDED_RETRIES = 3;

/**
 * 发布快照:写入 shallowRef、清空错误态,并同步到 legacy 的 store.market。
 * data 经 markRaw 处理——快照条目数万级,禁止被 Vue 深度代理。
 */
function publishSnapshot(value: MarketProvider.Payload): MarketSnapshot {
	const data = markRaw(value.data ?? {});
	const snapshot = markRaw({ ...value, data }) as MarketSnapshot;
	marketSnapshot.value = snapshot;
	snapshotKey = getSummaryKey(snapshot);
	marketSnapshotError.value = undefined;

	// Keep legacy consumers working without making the nested index reactive.
	store.market = {
		...(store.market ?? {}),
		...snapshot,
		data,
	};
	return snapshot;
}

/**
 * 请求市场快照:先尝试 http-gzip 传输(大数据走 HTTP + 浏览器缓存),
 * 失败则告警并回退 console 内联传输。
 */
async function requestMarketSnapshot() {
	const response = await (send("market/index" as any, {
		transport: "http-gzip",
	}) as Promise<MarketSnapshotResponse> | undefined);
	if (!response) throw new Error("market index request is unavailable");
	try {
		return await resolveMarketSnapshot(response);
	} catch (error) {
		if (!isMarketSnapshotTransfer(response)) throw error;
		console.warn(
			"[market-next] compressed market snapshot failed, falling back to console transport",
			error,
		);
		const fallback = await (send("market/index" as any, {
			transport: "inline",
		}) as Promise<MarketSnapshotResponse> | undefined);
		if (!fallback)
			throw new Error("market index fallback request is unavailable");
		return resolveMarketSnapshot(fallback);
	}
}

/** 当前可用的快照数据:优先 shallowRef,其次 legacy store。 */
export function getMarketSnapshotData() {
	return marketSnapshot.value?.data ?? store.market?.data ?? {};
}

/**
 * 把快照数据回填到 legacy store.market:服务端推送可能只带部分字段把
 * store.market.data 冲掉,此函数在检测到丢失时用 shallowRef 里的完整数据补回。
 */
export function restoreMarketSnapshot() {
	if (!store.market || store.market.data || !marketSnapshot.value) return;
	store.market = {
		...store.market,
		data: marketSnapshot.value.data,
	};
}

/** 加载市场快照(带 superseded 重试);force=true 时无视缓存强制刷新。 */
export function loadMarketSnapshot(force = false) {
	return loadMarketSnapshotAttempt(force, 0);
}

/**
 * 快照加载的带重试实现。缓存判定顺序:
 * 1. 无本地快照但 store.market 有数据 → 直接采用(服务端推送的初值);
 * 2. 已有快照且 store 摘要 key 未变 → 返回缓存;
 * 3. 有进行中任务且 key 匹配(或 store 尚无 key)→ 复用该任务;
 * 4. 否则发起新请求,响应回来后再次比对 store 的版本,被更新的数据
 *    取代则抛哨兵错误由外层重试(最多 3 次)。
 */
async function loadMarketSnapshotAttempt(
	force: boolean,
	supersededRetries: number,
): Promise<MarketSnapshot> {
	const key = getSummaryKey(store.market);
	if (!force && !marketSnapshot.value && store.market?.data) {
		return publishSnapshot(store.market);
	}
	if (!force && marketSnapshot.value && key && key === snapshotKey) {
		return marketSnapshot.value;
	}
	if (snapshotTask) {
		if (!force && (!key || key === snapshotTaskKey)) return snapshotTask;
		// store 已指向更新的数据:等旧任务落地后带着新 key 重进
		await snapshotTask.catch(() => undefined);
		return loadMarketSnapshotAttempt(force, supersededRetries);
	}

	marketSnapshotLoading.value = true;
	snapshotTaskKey = key;
	const task = (async () => {
		const value = await requestMarketSnapshot();
		if (
			isSnapshotSuperseded({
				storeVersion: store.market?.dataVersion,
				responseVersion: value.dataVersion,
				requestKey: key,
				currentKey: getSummaryKey(store.market),
				responseKey: getSummaryKey(value),
			})
		) {
			throw snapshotSuperseded;
		}
		return publishSnapshot(value);
	})()
		.catch((error) => {
			if (error !== snapshotSuperseded) marketSnapshotError.value = error;
			throw error;
		})
		.finally(() => {
			if (snapshotTask === task) snapshotTask = undefined;
			if (snapshotTaskKey === key) snapshotTaskKey = "";
			marketSnapshotLoading.value = false;
		}) as Promise<MarketSnapshot>;

	snapshotTask = task;
	try {
		return await task;
	} catch (error) {
		if (error === snapshotSuperseded) {
			if (supersededRetries < MAX_SNAPSHOT_SUPERSEDED_RETRIES) {
				return loadMarketSnapshotAttempt(true, supersededRetries + 1);
			}
			marketSnapshotError.value = snapshotRetryLimit;
			throw snapshotRetryLimit;
		}
		throw error;
	}
}

// 服务端增量补丁:只带变化条目时,与现有快照浅合并后重新发布
receive("market/patch", (value: Partial<MarketProvider.Payload>) => {
	if (!marketSnapshot.value || !value.data) return;
	publishSnapshot({
		...marketSnapshot.value,
		...value,
		data: {
			...marketSnapshot.value.data,
			...value.data,
		},
	});
});
