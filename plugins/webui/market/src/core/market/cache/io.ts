/**
 * @file 缓存写盘 I/O(core/market/cache 域)。
 *
 * 职责:把 v3 CacheStore 落盘 —— 每个带内联索引体的条目写入独立拆分文件
 * (sha1(endpoint) 命名),主清单只留元数据 + 拆分文件引用 + 路由统计;
 * 写完清理不再被引用的拆分文件。全部用 writeJsonAtomic 原子写,
 * 任一步失败只告警(缓存写失败不影响主流程)。
 *
 * 架构位置:被 MarketDiskCache.scheduleWrite 调用;拆分布局的意义是
 * 避免旧版单文件内联大 JSON 的读写放大。
 */
import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import { resolve } from "node:path";
import type { Dict } from "@koishi-ce/koishi";
import type { RouteStatsBook } from "../../racing/stats.js";
import { writeJsonAtomic } from "../../utils/atomic-write.js";
import { formatError } from "../../utils/format.js";
import { clamp } from "../../utils/math.js";
import type {
	CacheEntry,
	CacheFile,
	CacheStore,
	PersistedRouteStats,
} from "../types.js";

/** 写盘所需依赖面:两个缓存文件位置、路由统计与日志。 */
export interface CacheIoDeps {
	/** 主清单文件路径 */
	cacheFile: string;
	/** 拆分索引体文件目录 */
	cacheDir: string;
	/** 路由统计本(序列化进清单) */
	stats: RouteStatsBook;
	log: { debug(message: string): void; warn(message: string): void };
}

/** 路由统计共储序列化（v3 布局）。 */
export function serializeRouteStats(
	stats: RouteStatsBook,
): Dict<PersistedRouteStats> {
	const result: Dict<PersistedRouteStats> = {};
	for (const [endpoint, entry] of Object.entries(stats.stats)) {
		if (!entry) continue;
		result[endpoint] = {
			// 序列化时收敛到 [-6, 3],与 normalize 侧的 clamp 区间一致
			score: clamp(entry.score, -6, 3),
			averageElapsed: entry.averageElapsed,
			lastSuccess: entry.lastSuccess,
			contentEncoding: entry.contentEncoding,
			consecutiveFailures: entry.consecutiveFailures,
			cooldownUntil: entry.cooldownUntil,
		};
	}
	return result;
}

/** 原子写缓存清单 + 拆分条目文件，并清理失效拆分文件。移植自旧 MarketProvider 缓存写入族。 */
export async function writeCacheStore(deps: CacheIoDeps, cache: CacheStore) {
	try {
		const entries: Dict<CacheEntry> = {};
		for (const [endpoint, entry] of Object.entries(cache.entries)) {
			if (!entry) continue;
			if (Array.isArray(entry.result?.objects)) {
				// 内联索引体:写独立拆分文件,清单里只留元数据 + file 引用
				await writeEntryFile(deps, entry as CacheFile);
				const { result: _result, ...meta } = entry as CacheFile;
				entries[endpoint] = {
					...meta,
					file: entryFilename(endpoint),
					objects: _result.objects.length,
				};
			} else if (entry.file) {
				// 已是拆分形态(读盘时未加载索引体):原样保留引用
				entries[endpoint] = entry;
			}
		}
		await writeJsonAtomic(
			deps.cacheFile,
			{ ...cache, version: 3, entries },
			{ newline: false },
		);
		await pruneFiles(deps, entries);
	} catch (error) {
		// 缓存写失败不致命:下次拉取成功还会再调度写盘
		deps.log.warn(`failed to write market disk cache: ${formatError(error)}`);
	}
	return undefined;
}

/** 拆分文件名:endpoint 的 sha1 前 16 位(稳定且文件名安全)。 */
function entryFilename(endpoint: string) {
	return `${createHash("sha1").update(endpoint).digest("hex").slice(0, 16)}.json`;
}

/** 原子写单个条目的索引体文件。 */
async function writeEntryFile(deps: CacheIoDeps, entry: CacheFile) {
	await fsp.mkdir(deps.cacheDir, { recursive: true });
	const file = resolve(deps.cacheDir, entryFilename(entry.endpoint));
	await writeJsonAtomic(file, entry.result, { newline: false });
}

/** 清理不再被清单引用的拆分 .json 文件(条目被淘汰后回收磁盘)。 */
async function pruneFiles(deps: CacheIoDeps, entries: Dict<CacheEntry>) {
	try {
		const keep = new Set(
			Object.values(entries)
				.map((entry) => entry?.file)
				.filter(Boolean),
		);
		const files = await fsp.readdir(deps.cacheDir).catch(() => [] as string[]);
		await Promise.all(
			files
				.filter((file) => file.endsWith(".json") && !keep.has(file))
				.map((file) =>
					fsp.unlink(resolve(deps.cacheDir, file)).catch(() => {}),
				),
		);
	} catch (error) {
		deps.log.debug(
			`failed to prune split market cache files: ${formatError(error)}`,
		);
	}
}
