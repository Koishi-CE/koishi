/**
 * @file 头像的实际抓取与缓存回填(market/avatar 域)。
 *
 * 实际抓取经 market/avatar RPC 由服务端代理,绕过浏览器 CORS/防盗链限制;
 * pendingAvatarRequests 按 cacheKey 单飞,并发渲染的同一头像只发一次请求。
 */

import { send } from '@koishi-ce/client'
import {
  cacheAvatar,
  cacheAvatarFailure,
  getCachedAvatar,
  isDataUrl,
  normalizeAvatarCacheKey,
} from './cache'
import { normalizeAvatarUrl } from './candidates'

/** 进行中的抓取任务,按 cacheKey 单飞去重。 */
const pendingAvatarRequests = new Map<string, Promise<string>>()

/**
 * 抓取并缓存指定 URL 的头像:先查本地缓存与单飞表,都没命中才发
 * market/avatar RPC 让服务端代理抓取。成功写入缓存并返回 data: URI,
 * 失败按 cacheFailure 标记决定是否记录失败(浏览器已显示成功时传 false)。
 */
export async function fetchAndCacheAvatar(cacheKey: string, url: string, cacheFailure = true) {
  if (isDataUrl(url)) return url
  const key = normalizeAvatarCacheKey(cacheKey)
  const sourceUrl = normalizeAvatarUrl(url)
  const cached = getCachedAvatar(key)
  if (cached) return cached
  const pending = pendingAvatarRequests.get(key)
  if (pending) return pending
  const task = (async () => {
    const result = await (send('market/avatar', key, sourceUrl) ?? Promise.resolve(undefined))
      .catch(() => undefined) as { data?: string, type?: string, cached?: boolean } | undefined
    if (result?.data && result.type) {
      cacheAvatar(key, {
        data: result.data,
        type: result.type,
        cachedAt: Date.now(),
      })
      return `data:${result.type};base64,${result.data}`
    }
    if (cacheFailure) cacheAvatarFailure(key)
    return ''
  })().finally(() => {
    pendingAvatarRequests.delete(key)
  })
  pendingAvatarRequests.set(key, task)
  return task
}

/**
 * 只按 cacheKey 取头像(不带 url):服务端可能在自己那侧已有该 key 的
 * 缓存,RPC 会直接回放;适合空闲期"预水合"场景(package.vue 的
 * hydrateCachedAvatars)。失败不记录(留待真正渲染时再判定)。
 */
export async function fetchCachedAvatar(cacheKey: string) {
  if (isDataUrl(cacheKey)) return cacheKey
  const key = normalizeAvatarCacheKey(cacheKey)
  const cached = getCachedAvatar(key)
  if (cached) return cached
  const pendingKey = `cache:${key}`
  const pending = pendingAvatarRequests.get(pendingKey)
  if (pending) return pending
  const task = (async () => {
    const result = await (send('market/avatar', key) ?? Promise.resolve(undefined))
      .catch(() => undefined) as { data?: string, type?: string, cached?: boolean } | undefined
    if (result?.data && result.type) {
      cacheAvatar(key, {
        data: result.data,
        type: result.type,
        cachedAt: Date.now(),
      })
      return `data:${result.type};base64,${result.data}`
    }
    return ''
  })().finally(() => {
    pendingAvatarRequests.delete(pendingKey)
  })
  pendingAvatarRequests.set(pendingKey, task)
  return task
}
