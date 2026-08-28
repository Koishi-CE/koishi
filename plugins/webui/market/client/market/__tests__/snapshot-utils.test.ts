import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * @file 市场快照纯函数工具的单元测试。
 *
 * 覆盖:摘要 key 拼接、传输形态判定、http-gzip 补全(mock global.fetch)、
 * superseded 判定矩阵(版本落后/key 漂移/正常)、lookup 入参归一化。
 */

import {
  getSummaryKey,
  isMarketSnapshotTransfer,
  isSnapshotSuperseded,
  normalizeLookupValues,
  resolveMarketSnapshot,
} from '../snapshot-utils'

describe('getSummaryKey', () => {
    it('undefined 载荷返回空串', () => {
        expect(getSummaryKey(undefined)).toBe('')
    })

    it('dataVersion 与 debug hash 拼接成摘要 key', () => {
        expect(getSummaryKey({ dataVersion: 3 })).toBe('3:')
        expect(getSummaryKey({ dataVersion: 3, debug: { hash: 'abc' } as any })).toBe('3:abc')
    })
})

describe('isMarketSnapshotTransfer', () => {
    it('transport 为 http-gzip 才算传输形态', () => {
        expect(isMarketSnapshotTransfer({ transport: 'http-gzip', url: '/x', payload: {} } as any)).toBe(true)
        expect(isMarketSnapshotTransfer({ dataVersion: 1 } as any)).toBe(false)
    })
})

describe('resolveMarketSnapshot', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('非传输形态原样返回', async () => {
        const inline = { dataVersion: 1 } as any
        await expect(resolveMarketSnapshot(inline)).resolves.toBe(inline)
    })

    it('传输形态 fetch 数据本体并合并回 payload', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ 'pkg-a': { package: { name: 'pkg-a' } } }),
        }))
        const result = await resolveMarketSnapshot({
            transport: 'http-gzip',
            url: '/market.gz',
            payload: { dataVersion: 7 },
        } as any)
        expect(result.dataVersion).toBe(7)
        expect((result.data as any)['pkg-a'].package.name).toBe('pkg-a')
    })

    it('fetch 失败或返回非法 JSON 时抛错', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }))
        await expect(resolveMarketSnapshot({ transport: 'http-gzip', url: '/x', payload: {} } as any))
            .rejects.toThrow('market snapshot request failed with 502')
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [1, 2] }))
        await expect(resolveMarketSnapshot({ transport: 'http-gzip', url: '/x', payload: {} } as any))
            .rejects.toThrow('market snapshot response is invalid')
    })
})

describe('isSnapshotSuperseded', () => {
    const base = { storeVersion: 5, responseVersion: 5, requestKey: '5:a', currentKey: '5:a', responseKey: '5:a' }

    it('版本与 key 一致时未被取代', () => {
        expect(isSnapshotSuperseded(base)).toBe(false)
    })

    it('store 版本已比响应新时取代', () => {
        expect(isSnapshotSuperseded({ ...base, storeVersion: 6, responseVersion: 5 })).toBe(true)
    })

    it('请求期间 key 漂移且响应不是当前 store 那份时取代', () => {
        expect(isSnapshotSuperseded({ ...base, currentKey: '6:b', responseKey: '5:a' })).toBe(true)
    })

    it('key 漂移但响应恰好是当前 store 的那份时不取代', () => {
        expect(isSnapshotSuperseded({ ...base, currentKey: '6:b', responseKey: '6:b' })).toBe(false)
    })
})

describe('normalizeLookupValues', () => {
    it('剔除非字符串、trim、去空、去重', () => {
        expect(normalizeLookupValues([' a ', 'b', 'b', '', ' a', 42 as any, undefined as any])).toEqual(['a', 'b'])
    })
})
