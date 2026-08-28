/**
 * @file 头像的成功/失败双缓存与 TTL 判定(market/avatar 域)。
 *
 * 成功结果(base64)缓存 24h,失败的源缓存 10min,避免同一损坏 URL 反复
 * 请求;两个缓存各自限 256 条,超出按最新优先裁剪。失败缓存用 ref 包裹
 * (响应式),写入后 UI 立即切换到下一候选。
 */

import { ref } from 'vue'
import { createAvatarUrlCacheKey, type AvatarCandidate } from './candidates'

/** 成功缓存条目:data 为 base64 正文,type 为 MIME,cachedAt 用于 TTL 判定。 */
export type AvatarCacheEntry = {
  data: string
  type: string
  cachedAt: number
}

/** 失败缓存条目:只记时间,TTL 内不再尝试该源。 */
type AvatarFailureEntry = {
  failedAt: number
}

/** 成功缓存 TTL:24 小时。 */
const AVATAR_CACHE_TTL = 1000 * 60 * 60 * 24
/** 失败缓存 TTL:10 分钟(短暂记住坏源,过一会儿允许重试)。 */
export const AVATAR_FAILURE_TTL = 1000 * 60 * 10
/** 两个缓存各自的最大条目数(超出按最新优先裁剪)。 */
const AVATAR_CACHE_MAX = 256
const AVATAR_FAILURE_MAX = 256
/** 成功缓存:普通对象(读取方都是命令式调用,无需响应式)。 */
const avatarCache: Record<string, AvatarCacheEntry> = {}
/** 失败缓存:ref 包裹,写入后依赖它的 computed 立即重算切到下一候选。 */
const avatarFailureCache = ref<Record<string, AvatarFailureEntry>>({})
/** 测试钩子:直接清空两个缓存,避免用例间状态串扰。 */
export function resetAvatarCachesForTest() {
  for (const key of Object.keys(avatarCache)) delete avatarCache[key]
  avatarFailureCache.value = {}
}

/** 是否 data: 内联 URI(已自带内容,无需也不应走缓存/RPC)。仅供本域子模块共享。 */
export function isDataUrl(value: string) {
  return value.startsWith('data:')
}

/** 预留的持久化读取钩子(当前为空操作)。 */
function readAvatarCache() {
}

/**
 * 裁剪成功缓存:丢弃过期条目后按 cachedAt 从新到旧保留 AVATAR_CACHE_MAX 条。
 * 实现为先筛选排序得到白名单,再全量重建对象。
 */
function pruneAvatarCache() {
  const now = Date.now()
  const entries = Object.entries(avatarCache)
    .filter(([, entry]) => now - entry.cachedAt < AVATAR_CACHE_TTL)
    .sort((a, b) => b[1].cachedAt - a[1].cachedAt)
    .slice(0, AVATAR_CACHE_MAX)
  for (const key of Object.keys(avatarCache)) delete avatarCache[key]
  Object.assign(avatarCache, Object.fromEntries(entries))
}

/** 裁剪失败缓存:同 pruneAvatarCache,按 failedAt 从新到旧保留上限条数。 */
function pruneAvatarFailureCache() {
  const now = Date.now()
  avatarFailureCache.value = Object.fromEntries(Object.entries(avatarFailureCache.value)
    .filter(([, entry]) => now - entry.failedAt < AVATAR_FAILURE_TTL)
    .sort((a, b) => b[1].failedAt - a[1].failedAt)
    .slice(0, AVATAR_FAILURE_MAX))
}

/** 缓存 key 净化:非常规字符替换为 -,长度截到 128,空 key 退化为 md5。仅供本域子模块共享。 */
export function normalizeAvatarCacheKey(key: string) {
  return key.replace(/[^0-9A-Za-z:@._-]/g, '-').slice(0, 128) || createAvatarUrlCacheKey(key)
}

/** 写入成功缓存,同时清掉该 key 的失败标记并裁剪两个缓存。仅供本域子模块与测试共享。 */
export function cacheAvatar(cacheKey: string, entry: AvatarCacheEntry) {
  readAvatarCache()
  const key = normalizeAvatarCacheKey(cacheKey)
  delete avatarFailureCache.value[key]
  avatarCache[key] = entry
  pruneAvatarCache()
  pruneAvatarFailureCache()
}

/** 记录一次抓取失败(data: URI 无失败语义,跳过)。 */
export function cacheAvatarFailure(cacheKey: string) {
  if (isDataUrl(cacheKey)) return
  readAvatarCache()
  const key = normalizeAvatarCacheKey(cacheKey)
  avatarFailureCache.value = {
    ...avatarFailureCache.value,
    [key]: { failedAt: Date.now() },
  }
  pruneAvatarFailureCache()
}

/** 某缓存 key 是否处于失败冷却期(过期条目顺手清除)。 */
export function isAvatarFailureCached(cacheKey: string) {
  if (isDataUrl(cacheKey)) return false
  readAvatarCache()
  const key = normalizeAvatarCacheKey(cacheKey)
  const entry = avatarFailureCache.value[key]
  if (!entry) return false
  if (Date.now() - entry.failedAt >= AVATAR_FAILURE_TTL) {
    delete avatarFailureCache.value[key]
    return false
  }
  return true
}

/** 读成功缓存并拼成 data: URI;无缓存或已过期返回 undefined。仅供本域子模块与测试共享。 */
export function getCachedAvatar(cacheKey: string) {
  if (isDataUrl(cacheKey)) return cacheKey
  readAvatarCache()
  const key = normalizeAvatarCacheKey(cacheKey)
  const entry = avatarCache[key]
  if (!entry) return
  if (Date.now() - entry.cachedAt >= AVATAR_CACHE_TTL) {
    delete avatarCache[key]
    return
  }
  return `data:${entry.type};base64,${entry.data}`
}

/** 沿候选链逐个查成功缓存,返回第一个命中(都不命中返回 undefined)。 */
export function getCachedAvatarFromCandidates(candidates: AvatarCandidate[]) {
  for (const candidate of candidates) {
    const cached = getCachedAvatar(candidate.cacheKey)
    if (cached) return cached
  }
}
