/**
 * @file 市场搜索的索引缓存与相似度/搜索分引擎(market 域)。
 *
 * - getSearchIndex:条目的归一化搜索索引(WeakMap 缓存,含作者/分类/时间戳);
 * - 相似度打分(getSimilarityByIndex):查询词与包名的逐级匹配衰减;
 * - 搜索排序分(getSearchScoreByIndex):相似度权重 × 市场排名分
 *   (有 rating 用 rating,否则按更新时间对数衰减)。
 */

import type { SearchObject, User } from '@koishi-ce/registry'
import { isBundleSearchObject, resolveCategory } from './catalog'
import { getUsers } from './users'

export function normalizeSearchText(value: unknown) {
  return String(value ?? '').normalize('NFKC').toLowerCase()
}

export function normalizePackageName(name: string) {
  return normalizeSearchText(name).replace(/(koishi-|^@koishijs\/)plugin-/, '')
}

/** 查询词归一:去空白、转小写、丢空串。 */
export function normalizeFilterWords(words: string[]) {
  return words.map(word => word.trim().toLowerCase()).filter(Boolean)
}

export interface MarketSearchIndex {
  users: User[]
  normalizedName: string
  searchTexts: string[]
  category: string
  bundle: boolean
  createdAt: string
  updatedAt: string
  createdTimestamp: number
  updatedTimestamp: number
  rating?: number
}

const searchIndexCache = new WeakMap<SearchObject, MarketSearchIndex>()

export function getSearchIndex(data: SearchObject): MarketSearchIndex {
  const cached = searchIndexCache.get(data)
  if (cached) return cached
  const description = data.manifest?.description
  const descriptions = typeof description === 'string'
    ? [description]
    : Object.values(description ?? {})
  const rating = Number((data as SearchObject & { rating?: number }).rating)
  const index = {
    users: getUsers(data),
    normalizedName: normalizePackageName(data.package.name),
    searchTexts: [
    ...(data.package.keywords ?? []),
    ...descriptions,
    ].map(normalizeSearchText),
    category: resolveCategory(data.category),
    bundle: isBundleSearchObject(data),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    createdTimestamp: Date.parse(data.createdAt),
    updatedTimestamp: Date.parse(data.updatedAt),
    rating: Number.isFinite(rating) ? rating : undefined,
  }
  searchIndexCache.set(data, index)
  return index
}

export function getSimilarityByIndex(index: MarketSearchIndex, word: string) {
  const shortname = index.normalizedName
  if (shortname === word) return 1
  const tokens = shortname.split(/[-/_]/)
  if (tokens.includes(word)) return 0.5
  if (shortname.startsWith(word)) return 0.4
  if (tokens.some(t => t.startsWith(word))) return 0.3
  // 任何"某 token 包含 word"的情形必然被 shortname.includes(word) 抢先命中,
  // 此处不再设独立档位(原 0.2 档为不可达分支,已移除)
  if (shortname.includes(word)) return 0.25
  return index.searchTexts.some(keyword => keyword.includes(word)) ? 0.05 : 0
}

function getUpdatedScore(index: MarketSearchIndex, now = Date.now()) {
  const timestamp = index.updatedTimestamp
  if (!Number.isFinite(timestamp)) return 0
  const days = Math.max(0, (now - timestamp) / 86400000)
  return Math.max(0, 1 - Math.log2(days + 1) / 16)
}

function getMarketRankScore(index: MarketSearchIndex, now = Date.now()) {
  return index.rating ?? getUpdatedScore(index, now)
}

export function getSearchScoreByIndex(index: MarketSearchIndex, words: string[], now = Date.now()) {
  const rank = getMarketRankScore(index, now)
  if (!words.length) return rank
  let weight = 0
  for (const word of words) {
    const similarity = getSimilarityByIndex(index, word)
    if (!similarity) return 0
    weight += similarity
  }
  return rank * weight
}

export function getSearchWords(words: string[]) {
  return normalizeFilterWords(words)
    .filter(w => w && !w.includes(':'))
    .map(normalizePackageName)
}

