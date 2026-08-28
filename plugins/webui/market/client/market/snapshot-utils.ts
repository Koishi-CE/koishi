/**
 * @file 市场快照的纯函数工具(market 域)。
 *
 * 无 Vue 状态、无模块副作用,可独立单测:
 * - getSummaryKey:dataVersion+hash 的摘要 key;
 * - isMarketSnapshotTransfer/resolveMarketSnapshot:http-gzip 传输形态的
 *   判定与补全(fetch 数据本体后合并回 payload);
 * - isSnapshotSuperseded:响应回来后判定是否已被更新的数据取代;
 * - normalizeLookupValues:lookup 入参归一化。
 */

import type {
  MarketLookupRequest,
  MarketProvider,
  MarketSnapshotResponse,
  MarketSnapshotTransfer,
} from '../../src/shared'

/** 快照的有效形态:服务端保证 data 非空(inline 或已解压完成)。 */
export type MarketSnapshot = MarketProvider.Payload & {
  data: NonNullable<MarketProvider.Payload['data']>
}

/** 计算快照摘要 key:dataVersion + debug hash,用于快速判断两份数据是否一致。 */
export function getSummaryKey(value: Partial<MarketProvider.Payload> | undefined) {
  if (!value) return ''
  return [
    value.dataVersion ?? 0,
    value.debug?.hash ?? '',
  ].join(':')
}

/** 类型守卫:响应是否为"HTTP 传输"形态(数据本体在 url 指向的 gzip 资源里)。 */
export function isMarketSnapshotTransfer(value: MarketSnapshotResponse): value is MarketSnapshotTransfer {
  return !!value && 'transport' in value && value.transport === 'http-gzip'
}

/** 把传输形态的响应补全为完整快照载荷:fetch url 拿数据本体并合并回 payload。 */
export async function resolveMarketSnapshot(value: MarketSnapshotResponse): Promise<MarketProvider.Payload> {
  if (!isMarketSnapshotTransfer(value)) return value
  const response = await fetch(value.url, {
    cache: 'force-cache',
    credentials: 'same-origin',
  })
  if (!response.ok) throw new Error(`market snapshot request failed with ${response.status}`)
  const data = await response.json()
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('market snapshot response is invalid')
  }
  return {
    ...value.payload,
    data,
  }
}

/**
 * 响应落地前的 superseded 判定,两种情形任一成立即已被更新的数据取代:
 * 1. store 里的 dataVersion 已比响应新;
 * 2. 发起请求时的摘要 key 与现在 store 的 key 不一致,且响应也不是
 *    当前 store 的那份(说明请求期间 store 被第三份数据覆盖)。
 */
export function isSnapshotSuperseded(options: {
  storeVersion: number | undefined
  responseVersion: number | undefined
  requestKey: string
  currentKey: string
  responseKey: string
}) {
  if (options.storeVersion != null && options.responseVersion != null && options.storeVersion > options.responseVersion) {
    return true
  }
  return !!(options.requestKey
    && options.currentKey
    && options.currentKey !== options.requestKey
    && options.responseKey !== options.currentKey)
}

/** lookup 入参归一化:转数组、剔除非字符串、trim、去重、去空。 */
export function normalizeLookupValues(values: Iterable<string>) {
  return Array.from(new Set(Array.from(values)
    .filter(value => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean)))
}

/** lookup 请求的便捷形态(loadMarketLookup 内部也用它归一)。 */
export type LookupInput = Pick<MarketLookupRequest, 'names' | 'services'>
