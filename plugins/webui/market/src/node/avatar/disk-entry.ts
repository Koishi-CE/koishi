/**
 * @file 头像磁盘缓存的键归一化、文件路径构造与条目回读校验。
 *
 * 模块职责:
 * - normalizeAvatarCacheKey:把文件系统不安全字符替换成 "-" 并截断 128 字符;
 * - getAvatarCacheDir/getAvatarCacheFile:磁盘目录与 sha1 文件名构造;
 * - normalizeAvatarDiskCache:回读条目的防御性校验(结构/身份/type/过期),
 *   宁可 miss 也不能让脏数据回到内存缓存。
 *
 * 关键设计:
 * - 磁盘文件名 = sha1(归一化 key):归一化结果为空时回退整串 sha1,
 *   保证文件名安全且定长;
 * - 条目身份校验分两档:显式 key 匹配请求键,旧格式无 key 时退回 url 匹配;
 * - 各字段校验拆成独立小函数(readNonEmptyString 等),便于逐一审查。
 *
 * 架构位置:node 适配层 avatar 模块,被 disk-cache.ts 的读写与清扫消费。
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { Context } from "@koishi-ce/koishi";
import { AVATAR_CACHE_TTL, type AvatarFetchResult } from "./memory-cache.js";

/** 磁盘缓存条目:抓取结果 + 请求键、来源 URL 与写入时间(用于回读校验与判过期)。 */
export interface AvatarDiskCacheEntry extends AvatarFetchResult {
	key: string;
	url: string;
	cachedAt: number;
}

/** 磁盘缓存目录:baseDir/cache/market-next-avatars。 */
export function getAvatarCacheDir(ctx: Context) {
	return resolve(ctx.baseDir, "cache", "market-next-avatars");
}

/**
 * 归一化缓存键:把文件系统不安全字符替换成 "-",并截断到 128 字符。
 * 全部字符被过滤导致结果为空时,回退为整串 sha1,保证键恒非空且可参与
 * 文件名构造。
 */
export function normalizeAvatarCacheKey(key: string) {
	return (
		key.replace(/[^0-9A-Za-z:@._-]/g, "-").slice(0, 128) ||
		`url:${createHash("sha1").update(key).digest("hex")}`
	);
}

/** 缓存文件路径:目录 + sha1(归一化键).json(避免键超长或特殊字符进入文件名)。 */
export function getAvatarCacheFile(ctx: Context, key: string) {
	return resolve(
		getAvatarCacheDir(ctx),
		`${createHash("sha1").update(normalizeAvatarCacheKey(key)).digest("hex")}.json`,
	);
}

/**
 * 校验并归一化磁盘缓存条目:结构不完整、key(旧格式退回 url)与请求键不
 * 匹配、type 非 image/*、cachedAt 非法或已超过 TTL 的条目一律判无效,
 * 交由调用方删除文件。宁可 miss 也不能让脏数据回到内存缓存。
 */
export function normalizeAvatarDiskCache(
	value: unknown,
	key: string,
): AvatarDiskCacheEntry | undefined {
	const record = asRecord(value);
	if (!record) return;
	if (!matchesDiskCacheKey(record, key)) return;
	const url = readNonEmptyString(record, "url");
	const type = readImageType(record);
	const data = readNonEmptyString(record, "data");
	if (!url || !type || !data) return;
	const cachedAt = readFreshCachedAt(record);
	if (cachedAt === undefined) return;
	return { key, url, type, data, cachedAt };
}

/** 把 unknown 收窄为字符串字段表(null 与非对象返回 undefined)。 */
function asRecord(value: unknown) {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: undefined;
}

/** 校验条目身份:显式 key 与请求键比对;旧格式无 key 时退回 url 比对。 */
function matchesDiskCacheKey(record: Record<string, unknown>, key: string) {
	if (record["key"]) return record["key"] === key;
	return record["url"] === key;
}

/** 读取非空字符串字段,类型不符或为空串时返回 undefined。 */
function readNonEmptyString(record: Record<string, unknown>, field: string) {
	const value = record[field];
	return typeof value === "string" && value ? value : undefined;
}

/** 读取以 image/ 开头的 Content-Type 字段,其余一律判无效。 */
function readImageType(record: Record<string, unknown>) {
	const type = readNonEmptyString(record, "type");
	return type?.startsWith("image/") ? type : undefined;
}

/** 读取未超过 TTL 的写入时间戳;缺失、非有限数值或已过期返回 undefined。 */
function readFreshCachedAt(record: Record<string, unknown>) {
	const cachedAt = Number(record["cachedAt"]);
	if (!Number.isFinite(cachedAt)) return;
	if (Date.now() - cachedAt > AVATAR_CACHE_TTL) return;
	return cachedAt;
}
