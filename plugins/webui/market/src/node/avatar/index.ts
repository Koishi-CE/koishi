/**
 * @file 头像抓取入口:内存 -> 磁盘 -> 网络的三级取用门面。
 *
 * 模块职责:
 * - fetchAvatar:按归一化键取头像,命中内存/磁盘缓存直接返回,否则交给
 *   fetch.ts 的网络抓取管线(SSRF 校验 + HEAD 预检 + 限流读取),命中后
 *   双写两级缓存;
 * - 转发 memory-cache / disk-cache 的清理与清空能力,作为 avatar 模块
 *   的对外门面。
 *
 * 关键设计:
 * - 缓存取用与网络抓取分离:本文件只编排"查缓存 -> 抓网络 -> 写缓存"
 *   的次序,协议/SSRF/HEAD/限流等校验细节全部下沉 fetch.ts;
 * - 磁盘写不阻塞返回(命中路径的收益不值得等一次 fs);
 * - 每次取用顺手清扫内存缓存,过期/超限条目即时淘汰,不依赖宿主定时器。
 *
 * 架构位置:node 适配层 avatar 模块,由 console listener market/avatar 调用,
 * 供前端展示插件作者头像(gravatar/cravatar/npm)。
 */
import type { Context } from "@koishi-ce/koishi";
import {
	cleanupAvatarCaches,
	readAvatarDiskCache,
	writeAvatarDiskCache,
} from "./disk-cache.js";
import { clearAvatarCacheStorage } from "./disk-cleanup.js";
import { normalizeAvatarCacheKey } from "./disk-entry.js";
import { fetchAvatarFromNetwork } from "./fetch.js";
import {
	AVATAR_CACHE_SWEEP_INTERVAL,
	type AvatarFetchResult,
	cacheAvatarMemory,
	cleanupAvatarCache,
	clearAvatarMemoryCache,
	getAvatarMemoryCache,
} from "./memory-cache.js";

export {
	AVATAR_CACHE_SWEEP_INTERVAL,
	type AvatarFetchResult,
	cleanupAvatarCaches,
	clearAvatarCacheStorage,
	clearAvatarMemoryCache,
};

/**
 * 抓取头像:内存缓存 -> 磁盘缓存 -> 网络。返回 base64 数据与 MIME 类型,
 * 任何校验不通过(协议非 http(s)、SSRF 命中、HEAD 拦截、响应异常)都返回
 * undefined 而非抛错。网络命中后双写内存与磁盘缓存;sourceUrl 记录最终
 * 命中的重定向地址,供磁盘缓存回读时做"默认占位图"判定。
 */
export async function fetchAvatar(
	ctx: Context,
	rawKey: string,
	rawUrl?: string,
): Promise<AvatarFetchResult | undefined> {
	const cacheKey = normalizeAvatarCacheKey(rawKey);
	// 每次取用顺手清扫:过期/超限条目即时淘汰,不依赖宿主定时器
	cleanupAvatarCache();
	const cached = getAvatarMemoryCache(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		return { data: cached.data, type: cached.type, cached: true };
	}
	const diskCached = await readAvatarDiskCache(ctx, cacheKey);
	// 磁盘也未命中且没有来源 URL 时无从抓取,到此为止
	if (diskCached || !rawUrl) return diskCached;

	const fetched = await fetchAvatarFromNetwork(ctx, rawUrl);
	if (!fetched) return;
	cacheAvatarMemory(cacheKey, fetched.result);
	// 磁盘写不阻塞返回:命中路径的收益不值得等一次 fs
	void writeAvatarDiskCache(ctx, cacheKey, fetched.sourceUrl, fetched.result);
	cleanupAvatarCache();
	return fetched.result;
}
