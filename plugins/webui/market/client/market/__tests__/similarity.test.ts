import { describe, expect, it } from 'vitest'

/**
 * @file 搜索索引缓存与相似度/搜索分引擎的单元测试。
 *
 * 覆盖:查询词与包名归一化、getSearchIndex 的缓存与字段抽取(多语言描述/
 * rating 缺失)、getSimilarityByIndex 的全部衰减档位、getSearchScoreByIndex
 * 的空词/零相似度/rating 优先逻辑与 getSearchWords 的前缀过滤。
 */

import {
    getSearchIndex,
    getSearchScoreByIndex,
    getSearchWords,
    normalizeFilterWords,
    normalizePackageName,
    normalizeSearchText,
    getSimilarityByIndex,
} from '../similarity'
import { makeEntry, makeIndex } from './helpers'

describe('normalizeSearchText / normalizePackageName / normalizeFilterWords', () => {
    it('null/undefined 归空串,数字转字符串', () => {
        expect(normalizeSearchText(undefined)).toBe('')
        expect(normalizeSearchText(null)).toBe('')
        expect(normalizeSearchText(42)).toBe('42')
    })

    it('NFKC 归一并转小写', () => {
        expect(normalizeSearchText('ＦＯＯ')).toBe('foo')
        expect(normalizeSearchText('Ｆｏｏ Ｂａｒ')).toBe('foo bar')
    })

    it('包名归一:剥离官方/常规插件前缀,scoped 保留相对形态', () => {
        expect(normalizePackageName('koishi-plugin-foo')).toBe('foo')
        expect(normalizePackageName('@koishijs/plugin-foo')).toBe('foo')
        expect(normalizePackageName('@scope/koishi-plugin-foo')).toBe('@scope/foo')
        expect(normalizePackageName('Koishi-Plugin-Foo')).toBe('foo')
        expect(normalizePackageName('webui')).toBe('webui')
    })

    it('过滤词归一:trim、小写、丢空串', () => {
        expect(normalizeFilterWords(['  A ', 'b', '', '   '])).toEqual(['a', 'b'])
        expect(normalizeFilterWords([])).toEqual([])
    })
})

describe('getSearchIndex', () => {
    it('同一条目复用缓存的索引对象', () => {
        const entry = makeEntry()
        expect(getSearchIndex(entry)).toBe(getSearchIndex(entry))
    })

    it('抽取归一化包名、关键字与多语言描述', () => {
        const entry = makeEntry({
            package: {
                name: '@koishijs/plugin-Demo',
                keywords: ['Tool'],
                contributors: [],
                maintainers: [],
            },
            manifest: { description: { 'zh-CN': '你好', 'en-US': 'Hello' } },
            category: 'adapter',
        })
        const index = getSearchIndex(entry)
        expect(index.normalizedName).toBe('demo')
        expect(index.searchTexts).toEqual(['tool', '你好', 'hello'])
        expect(index.category).toBe('adapter')
        expect(index.bundle).toBe(false)
        expect(index.createdTimestamp).toBe(Date.parse('2024-01-01T00:00:00.000Z'))
        expect(index.updatedTimestamp).toBe(Date.parse('2024-06-01T00:00:00.000Z'))
        expect(index.rating).toBeUndefined()
    })

    it('字符串描述原样归一(不 trim),关键字缺省为空', () => {
        const described = getSearchIndex(makeEntry({ manifest: { description: '  Desc  ' } }))
        expect(described.searchTexts).toEqual(['  desc  '])
        const bare = getSearchIndex(makeEntry())
        expect(bare.searchTexts).toEqual([])
        expect(bare.category).toBe('other')
    })

    it('rating 为有效数值时保留,否则丢弃', () => {
        expect(getSearchIndex(makeEntry({ rating: 3 } as any)).rating).toBe(3)
        expect(getSearchIndex(makeEntry({ rating: 'x' } as any)).rating).toBeUndefined()
        expect(getSearchIndex(makeEntry()).rating).toBeUndefined()
    })

    it('非法日期解析为 NaN 时间戳', () => {
        const index = getSearchIndex(makeEntry({ createdAt: 'nope', updatedAt: 'nope' }))
        expect(index.createdTimestamp).toBeNaN()
        expect(index.updatedTimestamp).toBeNaN()
    })
})

describe('getSimilarityByIndex', () => {
    const index = makeIndex({ normalizedName: 'foo-bar', searchTexts: ['hello world'] })

    it('逐级衰减:全等 1 / token 命中 0.5 / 前缀 0.4 / token 前缀 0.3 / 包含 0.25', () => {
        expect(getSimilarityByIndex(index, 'foo-bar')).toBe(1)
        expect(getSimilarityByIndex(index, 'bar')).toBe(0.5)
        expect(getSimilarityByIndex(index, 'fo')).toBe(0.4)
        expect(getSimilarityByIndex(index, 'ba')).toBe(0.3)
        expect(getSimilarityByIndex(index, 'oo-b')).toBe(0.25)
    })

    it('搜索文本命中 0.05,全不命中 0', () => {
        expect(getSimilarityByIndex(index, 'hello')).toBe(0.05)
        expect(getSimilarityByIndex(index, 'zzz')).toBe(0)
    })

    it('斜杠与下划线也是 token 分隔', () => {
        const slashed = makeIndex({ normalizedName: 'foo/bar_baz' })
        expect(getSimilarityByIndex(slashed, 'baz')).toBe(0.5)
    })
})

describe('getSearchScoreByIndex', () => {
    it('无查询词时返回市场排名分:rating 优先', () => {
        expect(getSearchScoreByIndex(makeIndex({ rating: 4.5 }), [])).toBe(4.5)
    })

    it('无 rating 时按更新时间对数衰减,更新时间无效得 0', () => {
        const now = Date.now()
        const fresh = getSearchScoreByIndex(makeIndex({ updatedTimestamp: now }), [], now)
        expect(fresh).toBeGreaterThan(0)
        expect(fresh).toBeLessThanOrEqual(1)
        const stale = getSearchScoreByIndex(
            makeIndex({ updatedTimestamp: now - 86400000 * 400 }),
            [],
            now,
        )
        expect(stale).toBeLessThan(fresh)
        expect(getSearchScoreByIndex(makeIndex({ updatedTimestamp: NaN }), [], now)).toBe(0)
    })

    it('任一查询词零相似度直接 0,否则为 rank × 权重和', () => {
        const index = makeIndex({ rating: 4.5, normalizedName: 'foo-bar' })
        expect(getSearchScoreByIndex(index, ['zzz'])).toBe(0)
        expect(getSearchScoreByIndex(index, ['foo'])).toBeCloseTo(4.5 * 0.5, 10)
        expect(getSearchScoreByIndex(index, ['foo', 'foo-bar'])).toBeCloseTo(4.5 * 1.5, 10)
    })
})

describe('getSearchWords', () => {
    it('归一并剔除带冒号的修饰词,再剥包名前缀', () => {
        expect(getSearchWords(['Foo Bar', 'is:verified', '', 'koishi-plugin-webui'])).toEqual([
            'foo bar',
            'webui',
        ])
    })
})
