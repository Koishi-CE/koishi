/**
 * @file 市场按需查找(lookup)的状态层(market 域)。
 *
 * 按包名/服务名做增量 lookup:服务端只回传请求的那几条,避免整份快照下发。
 * 世代号(lookupGeneration)丢弃过期响应;同质请求按排序后的 key 单飞去重;
 * requestedMarketObjects/Services 登记历史请求,供快照换版后全量重放。
 */

import { send, store } from "@koishi-ce/client";
import { markRaw, shallowRef } from "vue";
import type { MarketLookupResult } from "../../src/shared";
import { collectServiceProviders } from "../../src/shared/lookup";
import { normalizeLookupValues, type LookupInput } from "./snapshot-utils";

/** lookup 结果缓存:包名 → 市场对象(仅含按需请求过的条目)。 */
const marketLookupData = shallowRef<Record<string, any>>({});
/** lookup 结果缓存:服务名 → 实现该服务的包名列表。 */
const marketLookupServices = shallowRef<Record<string, string[]>>({});
/** lookup 数据对应的快照 dataVersion(快照换版后需作废重放)。 */
let lookupDataVersion: number | undefined;
/** lookup 世代号:每次 refreshMarketLookups 自增,旧世代的响应直接丢弃。 */
let lookupGeneration = 0;
/** 进行中的 lookup 任务,按请求 key 去重。 */
const lookupTasks = new Map<string, Promise<void>>();
/** 确认在当前快照中不存在的包名(避免反复请求同一个 404 条目)。 */
const missingMarketObjects = new Set<string>();
/** 历史上请求过的包名(refreshMarketLookups 重放的依据)。 */
const requestedMarketObjects = new Set<string>();
/** 历史上请求过的服务名。 */
const requestedMarketServices = new Set<string>();

/** 取单个市场对象:先查 lookup 缓存,再查当前快照全量数据。 */
export function getMarketObject(name: string) {
	return marketLookupData.value[name] ?? store.market?.data?.[name];
}

/** 取实现某服务的包名列表(未查询过返回空数组)。 */
export function getMarketServiceProviders(name: string) {
	return marketLookupServices.value[name] ?? [];
}

/** 按包名做增量 lookup(去重/去空白后登记,供快照刷新时重放)。 */
export function loadMarketObjects(names: Iterable<string>) {
	const normalized = normalizeLookupValues(names);
	for (const name of normalized) requestedMarketObjects.add(name);
	return loadMarketLookup({ names: normalized });
}

/** 按服务名做增量 lookup:返回实现该服务的包名列表。 */
export function loadMarketServiceProviders(names: Iterable<string>) {
	const normalized = normalizeLookupValues(names);
	for (const name of normalized) requestedMarketServices.add(name);
	return loadMarketLookup({ services: normalized });
}

/**
 * 快照版本更新后的 lookup 全量重放:世代号 +1 使旧响应作废,清空全部
 * lookup 缓存与去重集合,再把历史请求过的包名/服务名一次性重新拉取。
 */
export async function refreshMarketLookups() {
	lookupGeneration++;
	lookupTasks.clear();
	lookupDataVersion = undefined;
	missingMarketObjects.clear();
	marketLookupData.value = {};
	marketLookupServices.value = {};
	const names = Array.from(requestedMarketObjects);
	const services = Array.from(requestedMarketServices);
	if (!names.length && !services.length) return;
	await loadMarketLookup({ names, services }, true);
}

/**
 * lookup 的核心实现。流程:
 * 1. 当前快照数据可用且非强制 → 直接本地满足(包名记入 missing 集合,
 *    服务名本地扫描),不发请求;
 * 2. 否则筛选出仍缺失的 pendingNames/pendingServices(已缓存、已确认
 *    missing、或快照没换版的直接跳过),全空则返回;
 * 3. 以排序后的请求 key 查 lookupTasks 做单飞去重,命中则复用;
 * 4. 发 market/lookup RPC,响应回来先验世代号与 dataVersion,过期
 *    (superseded)则带着 force 重进一次。
 */
async function loadMarketLookup(request: LookupInput, force = false) {
	const names = normalizeLookupValues(request.names ?? []);
	const services = normalizeLookupValues(request.services ?? []);
	if (!names.length && !services.length) return;

	const fullData = store.market?.data;
	if (fullData && !force) {
		for (const name of names) {
			if (!fullData[name]) missingMarketObjects.add(name);
		}
		if (services.length) {
			marketLookupServices.value = {
				...marketLookupServices.value,
				...collectServiceProviders(fullData, services),
			};
		}
		return;
	}

	const currentVersion = store.market?.dataVersion;
	const lookupCurrent =
		currentVersion == null ||
		lookupDataVersion == null ||
		lookupDataVersion === currentVersion;
	const pendingNames = force
		? names
		: names.filter((name) => {
				if (fullData?.[name]) return false;
				if (
					lookupCurrent &&
					(marketLookupData.value[name] || missingMarketObjects.has(name))
				)
					return false;
				return true;
			});
	const pendingServices = force
		? services
		: services.filter((name) => {
				return !Object.prototype.hasOwnProperty.call(
					marketLookupServices.value,
					name,
				);
			});
	if (!pendingNames.length && !pendingServices.length) return;

	const key = JSON.stringify([
		pendingNames.slice().sort(),
		pendingServices.slice().sort(),
		force,
	]);
	if (lookupTasks.has(key)) return lookupTasks.get(key);
	const generation = lookupGeneration;
	let superseded = false;
	const task = (async () => {
		const response = (await send("market/lookup", {
			names: pendingNames,
			services: pendingServices,
		})) as MarketLookupResult | undefined;
		if (!response || generation !== lookupGeneration) return;
		const latestVersion = store.market?.dataVersion;
		if (
			latestVersion != null &&
			response.dataVersion != null &&
			latestVersion > response.dataVersion
		) {
			superseded = true;
			return;
		}
		lookupDataVersion = response.dataVersion;
		for (const name of pendingNames) {
			if (!response.data[name]) missingMarketObjects.add(name);
		}
		marketLookupData.value = markRaw({
			...marketLookupData.value,
			...response.data,
		});
		marketLookupServices.value = {
			...marketLookupServices.value,
			...response.services,
		};
	})().finally(() => {
		if (lookupTasks.get(key) === task) lookupTasks.delete(key);
	});
	lookupTasks.set(key, task);
	await task;
	if (superseded)
		return loadMarketLookup(
			{ names: pendingNames, services: pendingServices },
			true,
		);
}
