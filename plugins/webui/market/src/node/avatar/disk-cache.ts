/**
 * @file 头像磁盘缓存的读写:baseDir/cache/market-next-avatars 下的 JSON 存取。
 *
 * 模块职责:
 * - readAvatarDiskCache:读回磁盘条目,经 normalizeAvatarDiskCache 校验后
 *   回填内存缓存;条目无效或疑似 gravatar 默认占位图的直接删除、不回填;
 * - writeAvatarDiskCache:原子写盘(writeJsonAtomic,避免读到半截 JSON);
 * - cleanupAvatarCaches:全量清理入口(先清内存,再异步触发磁盘清扫)。
 *
 * 关键设计:
 * - 疑似默认占位图的条目不落盘也不回读:占位图与具体用户无关,缓存只会污染;
 * - 读写失败都静默降级(缓存只加速,不影响正确性),读失败只记 debug,
 *   ENOENT(首次无缓存)连日志都不记;
 * - 磁盘命中回填内存时过期时间沿用磁盘条目的 cachedAt + TTL,而非重新计时。
 *
 * 架构位置:node 适配层 avatar 模块,被 avatar/index.ts 的 fetchAvatar 消费;
 * 键归一化与条目校验见 disk-entry.ts,清扫与清空见 disk-cleanup.ts,
 * 内存缓存原语见 memory-cache.ts。
 */
import { promises as fsp } from "node:fs";
import type { Context } from "@koishi-ce/koishi";
import { writeJsonAtomic } from "../../core/utils/atomic-write.js";
import { cleanupAvatarDiskCache } from "./disk-cleanup.js";
import {
    type AvatarDiskCacheEntry,
    getAvatarCacheFile,
    normalizeAvatarDiskCache,
} from "./disk-entry.js";
import {
    AVATAR_CACHE_TTL,
    type AvatarFetchResult,
    avatarCache,
    cleanupAvatarCache,
} from "./memory-cache.js";
import { isAvatarCacheLikelyDefault } from "./ssrf.js";

/** 全量清理入口:先清内存,再异步触发磁盘清理(void:不等待扫盘完成)。 */
export function cleanupAvatarCaches(ctx: Context) {
    cleanupAvatarCache();
    void cleanupAvatarDiskCache(ctx);
}

/**
 * 读取磁盘缓存:命中且有效时回填内存缓存并返回 cached: true;条目无效或
 * 疑似 gravatar 默认占位图时删除文件并返回 undefined(占位图不配占用缓存)。
 * 读失败只记 debug,ENOENT(首次无缓存)连日志都不记。
 */
export async function readAvatarDiskCache(
    ctx: Context,
    key: string,
): Promise<AvatarFetchResult | undefined> {
    try {
        const file = getAvatarCacheFile(ctx, key);
        const entry = normalizeAvatarDiskCache(JSON.parse(await fsp.readFile(file, "utf8")), key);
        if (!entry) {
            // 无效条目顺手清掉,避免下次再解析一遍
            void fsp.unlink(file).catch(() => {});
            return;
        }
        if (isAvatarCacheLikelyDefault(entry.url, key)) {
            void fsp.unlink(file).catch(() => {});
            return;
        }
        // 回填内存缓存:过期时间沿用磁盘条目的 cachedAt + TTL,而非重新计时
        avatarCache.set(key, {
            data: entry.data,
            type: entry.type,
            expiresAt: entry.cachedAt + AVATAR_CACHE_TTL,
        });
        return { data: entry.data, type: entry.type, cached: true };
    } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
            ctx.logger("market").debug(
                `failed to read avatar disk cache: ${error instanceof Error ? error.message : error}`,
            );
        }
    }
    return undefined;
}

/**
 * 写入磁盘缓存(原子写)。失败只记 debug:磁盘缓存写失败只损失跨重启的
 * 命中率,不应打断头像抓取主流程。
 */
export async function writeAvatarDiskCache(
    ctx: Context,
    key: string,
    url: string,
    result: AvatarFetchResult,
) {
    try {
        const file = getAvatarCacheFile(ctx, key);
        const entry: AvatarDiskCacheEntry = {
            key,
            url,
            type: result.type,
            data: result.data,
            cachedAt: Date.now(),
        };
        await writeJsonAtomic(file, entry, { newline: false });
    } catch (error) {
        ctx.logger("market").debug(
            `failed to write avatar disk cache: ${error instanceof Error ? error.message : error}`,
        );
    }
}
