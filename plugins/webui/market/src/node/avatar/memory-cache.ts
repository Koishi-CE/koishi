/**
 * @file 头像进程内缓存:模块级 Map + TTL/FIFO 双策略淘汰。
 *
 * 模块职责:
 * - 内存缓存(TTL 7 天、上限 512 条)提供零 I/O 的同步命中路径;
 * - 承载内存/磁盘两级缓存共用的 TTL 与条数上限常量(磁盘条目回读回填、
 *   磁盘清扫超限淘汰都引用同一组值);
 * - 对外提供内存缓存的读/写/清扫/清空原语,由 disk-cache.ts 与
 *   avatar/index.ts 的 fetchAvatar 消费。
 *
 * 关键设计:
 * - avatarCache Map 与过期时间戳由本模块单点持有:磁盘命中回填时沿用
 *   磁盘条目的 cachedAt + TTL,而非重新计时,因此暴露 Map 供回填写入;
 * - 清扫先删过期条目,再按插入顺序(FIFO)逐出最旧条目直至回到上限。
 *
 * 架构位置:node 适配层 avatar 模块,被 disk-cache.ts(回填/清空)与
 * avatar/index.ts(取用/清扫)消费。
 */
import { Time } from "@koishi-ce/koishi";

/** 头像抓取/缓存命中的统一返回结构。 */
export interface AvatarFetchResult {
	/** base64 编码的图片内容 */
	data: string;
	/** Content-Type(本模块只接受 image/* 前缀) */
	type: string;
	/** 命中缓存时为 true */
	cached?: boolean;
	/** 预留字段:当前实现不填充,磁盘条目的 key 存在 AvatarDiskCacheEntry 上 */
	key?: string;
}

/** 内存缓存:key = 归一化缓存键,value = 抓取结果 + 过期时间戳(avatar 模块内共享)。 */
export const avatarCache = new Map<
	string,
	AvatarFetchResult & { expiresAt: number }
>();
/** 缓存有效期(内存与磁盘共用同一 TTL):7 天。 */
export const AVATAR_CACHE_TTL = Time.day * 7;
/** 对外暴露的清扫间隔(1 小时),供 index.ts / 宿主注册定时清扫。 */
export const AVATAR_CACHE_SWEEP_INTERVAL = Time.hour;
/** 缓存条数上限:超出后按插入顺序(FIFO)逐出最旧条目。 */
export const AVATAR_MAX_ENTRIES = 512;

/** 清扫内存缓存:先删过期条目,再按插入顺序逐出最旧的直至回到上限。 */
export function cleanupAvatarCache() {
	const now = Date.now();
	for (const [key, entry] of avatarCache) {
		if (entry.expiresAt <= now) avatarCache.delete(key);
	}
	while (avatarCache.size > AVATAR_MAX_ENTRIES) {
		const key = avatarCache.keys().next().value;
		if (!key) break;
		avatarCache.delete(key);
	}
}

/** 清空内存缓存(测试与手动清理用,不碰磁盘)。 */
export function clearAvatarMemoryCache() {
	avatarCache.clear();
}

/** 读内存缓存条目(含 expiresAt,是否过期由调用方判断)。 */
export function getAvatarMemoryCache(key: string) {
	return avatarCache.get(key);
}

/** 写入内存缓存条目,按 TTL 附加过期时间。 */
export function cacheAvatarMemory(key: string, result: AvatarFetchResult) {
	avatarCache.set(key, { ...result, expiresAt: Date.now() + AVATAR_CACHE_TTL });
}
