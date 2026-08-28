/**
 * @file 缓存状态应用纯函数(core/market/cache 域)。
 *
 * 职责:把"拉取成功"与"条件请求查询"两类输入计算成缓存状态的下一步:
 * applyEndpointResult 合并新响应与旧条目/旧元数据(304 场景沿用旧
 * etag/统计,元数据合并细节在 persistence.buildCacheMeta);
 * buildConditionalHeaders 产出条件请求头(etag/If-Modified-Since)。
 * 全部为纯计算,不触碰磁盘 I/O 与防抖定时器。
 *
 * 架构位置:MarketDiskCache.updateState/conditionalHeaders 的主体,
 * 经 index.ts 薄转发对外保持类契约面不变。
 */
import type { Dict } from "@koishi-ce/koishi";
import type { CacheEntry, CacheMeta, EndpointResult } from "../types.js";
import { buildCacheMeta } from "./persistence.js";

/**
 * 拉取成功后的状态计算:合并出新元数据与对应条目。
 * etag/lastModified 缺失时(如 304 响应不带新值)沿用旧值,
 * hash/size 等统计字段同样尽量保留上一轮(细节见 buildCacheMeta)。
 */
export function applyEndpointResult(
	result: EndpointResult,
	entries: Dict<CacheEntry>,
	meta: CacheMeta | undefined,
): { meta: CacheMeta; entry: CacheEntry } {
	const cached = entries[result.endpoint];
	const sameEndpoint = meta?.endpoint === result.endpoint;
	const nextMeta = buildCacheMeta(result, cached, meta, sameEndpoint);
	const entry: CacheEntry = {
		...nextMeta,
		result: result.result,
	};
	return { meta: nextMeta, entry };
}

/**
 * 条件请求头计算(etag/If-Modified-Since):优先取端点条目,
 * 条目缺失时退回当前生效 meta(端点一致才有条件值)。
 */
export function buildConditionalHeaders(
	entries: Dict<CacheEntry>,
	meta: CacheMeta | undefined,
	endpoint: string,
): Dict<string> {
	const entry =
		entries[endpoint] || (meta?.endpoint === endpoint ? meta : undefined);
	if (!entry) return {};
	const headers: Dict<string> = {};
	if (entry.etag) headers["if-none-match"] = entry.etag;
	if (entry.lastModified) headers["if-modified-since"] = entry.lastModified;
	return headers;
}
