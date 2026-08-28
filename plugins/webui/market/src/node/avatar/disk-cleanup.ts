/**
 * @file 头像磁盘缓存的清理族:后台清扫与彻底清空。
 *
 * 模块职责:
 * - cleanupAvatarDiskCache:单飞清扫,扫描目录内全部 .json,结构损坏、
 *   疑似默认占位图、超过 TTL 的文件就地删除;幸存条目按 cachedAt 从新到旧
 *   排序,超出上限的末尾部分批量删除;
 * - clearAvatarCacheStorage:彻底清空(内存 + 在途任务收尾 + 整目录递归删除),
 *   供 clear-avatar-cache 命令回显删除前的条数统计。
 *
 * 关键设计:
 * - 清理任务单飞去重:并发调用复用同一轮任务,结束后清空引用允许下轮;
 * - 巡检按文件逐个进行,mtime 兜底(JSON 解析失败或没有 cachedAt 时按
 *   文件时间判过期),所有清理失败都静默降级(缓存只加速,不影响正确性)。
 *
 * 架构位置:node 适配层 avatar 模块,由 disk-cache.ts 的 cleanupAvatarCaches
 * 与 avatar/index.ts 的 clearAvatarCacheStorage 转发消费。
 */
import { promises as fsp } from "node:fs";
import { resolve } from "node:path";
import type { Context } from "@koishi-ce/koishi";
import { getAvatarCacheDir, normalizeAvatarCacheKey } from "./disk-entry.js";
import { AVATAR_CACHE_TTL, AVATAR_MAX_ENTRIES, avatarCache } from "./memory-cache.js";
import { isAvatarCacheLikelyDefault } from "./ssrf.js";

/** 进行中的磁盘清理任务(单飞:并发调用复用同一轮清理)。 */
let avatarDiskCleanupTask: Promise<void> | undefined;

/**
 * 磁盘清理(单飞去重:并发调用复用同一轮任务,结束后清空引用允许下轮)。
 * 扫描目录内全部 .json:结构损坏、疑似默认占位图、超过 TTL 的文件就地删除;
 * 幸存条目按 cachedAt 从新到旧排序,超出上限的末尾部分批量删除。
 */
export async function cleanupAvatarDiskCache(ctx: Context) {
    if (avatarDiskCleanupTask) return avatarDiskCleanupTask;
    avatarDiskCleanupTask = (async () => {
        try {
            const dir = getAvatarCacheDir(ctx);
            // 目录不存在(从未写过缓存)视作空目录
            const files = await fsp.readdir(dir).catch(() => [] as string[]);
            const entries = await Promise.all(
                files
                    .filter((file) => file.endsWith(".json"))
                    .map((file) => inspectAvatarCacheFile(dir, file)),
            );
            const alive = entries.filter(
                (entry): entry is { path: string; cachedAt: number } => !!entry,
            );
            // 新->旧排序后,超过上限的尾部即最旧条目,批量删除
            alive.sort((a, b) => b.cachedAt - a.cachedAt);
            await Promise.all(
                alive
                    .slice(AVATAR_MAX_ENTRIES)
                    .map((entry) => fsp.unlink(entry.path).catch(() => {})),
            );
        } finally {
            avatarDiskCleanupTask = undefined;
        }
    })();
    return avatarDiskCleanupTask;
}

/**
 * 单文件巡检:幸存返回路径与写入时间(供超限淘汰排序);结构损坏、疑似
 * 默认占位图或超过 TTL 的就地删除后返回 undefined;stat 失败(文件刚被
 * 并发删除等)同样返回 undefined 交由下一轮清扫兜底。
 */
async function inspectAvatarCacheFile(dir: string, file: string) {
    const path = resolve(dir, file);
    try {
        const stat = await fsp.stat(path);
        // mtime 兜底:JSON 解析失败或没有 cachedAt 时按文件时间判过期
        let cachedAt = stat.mtimeMs;
        try {
            const value = JSON.parse(await fsp.readFile(path, "utf8"));
            cachedAt = Number(value.cachedAt) || cachedAt;
            if (!isDurableCacheEntry(value)) {
                await fsp.unlink(path).catch(() => {});
                return;
            }
            if (isAvatarCacheLikelyDefault(value.url, normalizeAvatarCacheKey(value.key))) {
                await fsp.unlink(path).catch(() => {});
                return;
            }
        } catch {
            await fsp.unlink(path).catch(() => {});
            return;
        }
        if (Date.now() - cachedAt > AVATAR_CACHE_TTL) {
            await fsp.unlink(path).catch(() => {});
            return;
        }
        return { path, cachedAt };
    } catch {
        return;
    }
}

/** 磁盘条目结构校验:key/url/data/type 四字段齐备才可参与后续判定。 */
function isDurableCacheEntry(value: unknown) {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return (
        !!record["key"] &&
        !!record["url"] &&
        typeof record["data"] === "string" &&
        typeof record["type"] === "string"
    );
}

/**
 * 彻底清空缓存存储:清内存、等待在途清理任务收尾、整目录递归删除。
 * 返回删除前的内存条数与磁盘 .json 文件数,供 clear-avatar-cache 命令回显。
 */
export async function clearAvatarCacheStorage(ctx: Context) {
    const memory = avatarCache.size;
    avatarCache.clear();
    if (avatarDiskCleanupTask) await avatarDiskCleanupTask.catch(() => {});
    const dir = getAvatarCacheDir(ctx);
    const files = await fsp.readdir(dir).catch((error) => {
        if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return [] as string[];
        throw error;
    });
    const disk = files.filter((file) => file.endsWith(".json")).length;
    await fsp.rm(dir, { recursive: true, force: true });
    return { memory, disk };
}
