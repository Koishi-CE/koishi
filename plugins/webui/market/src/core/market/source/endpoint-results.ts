/**
 * @file 单端点结果的三种构造路径(core/market/source 域)。
 *
 * 职责:把一次端点请求归一到 EndpointFetchResult —— 304 时复用磁盘缓存
 * (resolveFrom304Cache)、内容哈希命中时复用缓存对象免解析
 * (matchHashCache + buildHashCacheResult)、否则解析网络正文
 * (parseNetworkResult)。被 fetch-endpoint.ts 按响应状态分发调用。
 */
import { createHash } from "node:crypto";
import type { SearchResult } from "@koishi-ce/registry";
import { formatBytes, shortHash } from "../../utils/format.js";
import type { CacheEntry, CacheFile } from "../types.js";
import type {
	EndpointFetchResult,
	FetchEndpointDeps,
	MarketHttp,
} from "./fetch-endpoint.js";

/** 单次 HTTP 请求的统一上下文(响应 + 条件头回显 + 耗时)。 */
export interface EndpointRequest {
	/** getText 的原始响应(200/304 都算成功) */
	response: Awaited<ReturnType<MarketHttp["getText"]>>;
	/** 请求耗时(ms) */
	requestElapsed: number;
	etag?: string | undefined;
	lastModified?: string | undefined;
	contentEncoding?: string | undefined;
	/** 响应头 content-length 解析值(可能缺失) */
	headerWireSize: number | undefined;
}

/** 304 命中：复用磁盘缓存条目。 */
export async function resolveFrom304Cache(
	deps: FetchEndpointDeps,
	endpoint: string,
	total: number,
	start: number,
	request: EndpointRequest,
	cachedEntry: CacheEntry | undefined,
): Promise<EndpointFetchResult> {
	const cache = cachedEntry && (await deps.loadCacheEntryResult(cachedEntry));
	// 304 说明服务端认为缓存仍新鲜,但本地却没有对应缓存:状态不一致,只能报错
	if (!cache)
		throw new Error(`market index from ${endpoint} returned 304 without cache`);
	const elapsed = Date.now() - start;
	return {
		endpoint,
		result: cache.result,
		elapsed,
		candidates: total,
		source: "http-304",
		timings: { request: request.requestElapsed, total: elapsed },
		size: cache.size,
		wireSize: request.headerWireSize ?? cache.wireSize,
		contentEncoding: request.contentEncoding ?? cache.contentEncoding,
		hash: cache.hash,
		etag: request.etag || cache.etag,
		lastModified: request.lastModified || cache.lastModified,
		cachedAt: cache.fetchedAt,
		validatedAt: Date.now(),
	};
}

/**
 * 内容哈希比对复用（同内容不再重复解析）。
 * 计算正文 sha256 并尝试匹配缓存条目:哈希与缓存一致时返回已加载的
 * CacheFile(可复用缓存对象,跳过整份 JSON.parse)。
 */
export async function matchHashCache(
	deps: FetchEndpointDeps,
	text: string,
	cachedEntry: CacheEntry | undefined,
): Promise<{
	hash: string;
	hashElapsed: number;
	cache?: CacheFile | undefined;
}> {
	const hashStart = Date.now();
	const hash = createHash("sha256").update(text).digest("hex");
	const hashElapsed = Date.now() - hashStart;
	const cache =
		cachedEntry && cachedEntry.hash === hash
			? await deps.loadCacheEntryResult(cachedEntry)
			: undefined;
	return { hash, hashElapsed, cache };
}

/** 内容哈希命中：复用缓存条目并构建 hash-cache 结果。 */
export function buildHashCacheResult(
	deps: FetchEndpointDeps,
	endpoint: string,
	total: number,
	start: number,
	request: EndpointRequest,
	hash: string,
	hashElapsed: number,
	size: number,
	wireSize: number | undefined,
	hashCache: CacheFile,
): EndpointFetchResult {
	const elapsed = Date.now() - start;
	deps.log.debug(
		`market index hash-cache: endpoint=${endpoint}, hash=${shortHash(hash)}`,
	);
	return {
		endpoint,
		result: hashCache.result,
		elapsed,
		candidates: total,
		source: "hash-cache",
		timings: {
			request: request.requestElapsed,
			hash: hashElapsed,
			total: elapsed,
		},
		size,
		wireSize,
		contentEncoding: request.contentEncoding,
		hash,
		etag: request.etag,
		lastModified: request.lastModified,
		cachedAt: hashCache.fetchedAt,
		validatedAt: Date.now(),
	};
}

/** 网络体解析并构建 network 结果。 */
export function parseNetworkResult(
	deps: FetchEndpointDeps,
	endpoint: string,
	total: number,
	start: number,
	request: EndpointRequest,
	text: string,
	size: number,
	wireSize: number | undefined,
	hash: string,
	hashElapsed: number,
): EndpointFetchResult {
	const parseStart = Date.now();
	const result = JSON.parse(text) as SearchResult;
	// objects 非数组 = 不是市场索引(可能是错误页),立即判失败交给竞速下一个端点
	if (!Array.isArray(result?.objects)) {
		throw new Error(`invalid market index from ${endpoint}`);
	}
	const parseElapsed = Date.now() - parseStart;
	const elapsed = Date.now() - start;
	deps.log.debug(
		`market index fetched: endpoint=${endpoint}, elapsed=${elapsed}ms, objects=${result.objects.length}, size=${formatBytes(size)}, hash=${shortHash(hash)}`,
	);
	return {
		endpoint,
		result,
		elapsed,
		candidates: total,
		source: "network",
		timings: {
			request: request.requestElapsed,
			hash: hashElapsed,
			parse: parseElapsed,
			total: elapsed,
		},
		size,
		wireSize,
		contentEncoding: request.contentEncoding,
		hash,
		etag: request.etag,
		lastModified: request.lastModified,
		cachedAt: undefined,
		validatedAt: undefined,
	};
}
