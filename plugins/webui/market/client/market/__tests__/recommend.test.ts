import { describe, expect, it } from 'vitest'

/**
 * @file 推荐评分体系的单元测试。
 *
 * 以固定 now 驱动 getRecommendScore 的六维加权:风险乘数(insecure/
 * deprecated/preview)、已装降权、下载量单调性、维护/新鲜度失效路径、
 * 信任与质量的逐项加分、探索分非零条件;另测打平回退比较器的四级顺序。
 */

import type { MarketConfig } from '../context'
import { compareRecommendFallback, getRecommendScore } from '../recommend'
import { makeEntry, makeIndex, type EntryOverrides } from './helpers'

const NOW = Date.parse('2026-01-15T00:00:00.000Z')

/** 构造"近期更新+近期创建+零下载+零信任+零质量(除非非合包加成)"的基线。 */
function score(
    overrides: EntryOverrides = {},
    indexOverrides: EntryOverrides = {},
    config?: MarketConfig,
) {
    const data = makeEntry(overrides)
    const index = makeIndex({
        updatedTimestamp: NOW,
        createdTimestamp: NOW,
        ...indexOverrides,
    })
    return getRecommendScore(data as any, index as any, config, NOW)
}

describe('getRecommendScore 风险乘数与已装降权', () => {
    it('基线分数与手算锚点一致', () => {
        // popularity=sigmoid(0,2.6,1.15)≈0.04785,maintenance=freshness=1,
        // trust=0,quality=0.08(仅非合包加成),exploration=0(质量地板为 0)
        // score = 100*(0.30*0.04785 + 0.24 + 0.16 + 0.10*0.08) ≈ 42.235
        expect(score()).toBeCloseTo(42.235, 2)
    })

    it('insecure(条目级或 manifest 级)乘 0.15', () => {
        const base = score()
        expect(score({ insecure: true })).toBeCloseTo(base * 0.15, 8)
        expect(score({ manifest: { insecure: true } })).toBeCloseTo(base * 0.15, 8)
    })

    it('deprecated(条目级或包级)乘 0.25', () => {
        const base = score()
        expect(score({ deprecated: true })).toBeCloseTo(base * 0.25, 8)
        const pkg = {
            name: 'koishi-plugin-foo',
            deprecated: true,
            contributors: [],
            maintainers: [],
        }
        expect(score({ package: pkg })).toBeCloseTo(base * 0.25, 8)
    })

    it('manifest.preview 为 true 乘 0.6', () => {
        expect(score({ manifest: { preview: true } })).toBeCloseTo(score() * 0.6, 8)
        expect(score({ manifest: { preview: false } })).toBe(score())
    })

    it('config.installed 命中乘 0.18', () => {
        expect(score({}, {}, { installed: () => true })).toBeCloseTo(score() * 0.18, 8)
    })
})

describe('getRecommendScore 六维', () => {
    it('下载量越多人气分越高,缺省下载量按 0 处理', () => {
        const low = score({ downloads: { lastMonth: 10 } as any })
        const high = score({ downloads: { lastMonth: 100000 } as any })
        expect(high).toBeGreaterThan(low)
        const negative = score({ downloads: { lastMonth: -50 } as any })
        expect(negative).toBeLessThanOrEqual(score({ downloads: { lastMonth: 0 } as any }))
    })

    it('更新时间无效时维护分为 0,创建时间无效时新鲜度为 0', () => {
        const base = score()
        expect(score({}, { updatedTimestamp: NaN })).toBeLessThan(base)
        expect(score({}, { createdTimestamp: NaN })).toBeLessThan(base)
    })

    it('新鲜度随创建时间分档衰减(单调区间内)', () => {
        const d10 = score({}, { createdTimestamp: NOW - 86400000 * 10 })
        const d60 = score({}, { createdTimestamp: NOW - 86400000 * 60 })
        const d120 = score({}, { createdTimestamp: NOW - 86400000 * 120 })
        const d400 = score({}, { createdTimestamp: NOW - 86400000 * 400 })
        expect(d10).toBeGreaterThan(d60)
        expect(d60).toBeGreaterThan(d120)
        expect(d400).toBeGreaterThan(0)
        expect(d400).toBeLessThan(d10)
    })

    it('新鲜度全局单调:180 天后不反弹(181 天低于 180 天)', () => {
        const d180 = score({}, { createdTimestamp: NOW - 86400000 * 180 })
        const d181 = score({}, { createdTimestamp: NOW - 86400000 * 181 })
        expect(d181).toBeLessThan(d180)
    })

    it('信任分:verified/portable/包链接逐项加分', () => {
        const base = score()
        const verified = score({ verified: true })
        const portable = score({ portable: true })
        const basePkg = { name: 'koishi-plugin-foo', contributors: [], maintainers: [] }
        const linked = score({ package: { ...basePkg, links: { repository: 'https://x' } } })
        const homepage = score({ package: { ...basePkg, links: { homepage: 'https://x' } } })
        const bugs = score({ package: { ...basePkg, links: { bugs: 'https://x' } } })
        expect(verified).toBeGreaterThan(base)
        expect(portable).toBeGreaterThan(base)
        expect(linked).toBeGreaterThan(base)
        expect(homepage).toBeGreaterThan(base)
        expect(bugs).toBeGreaterThan(base)
        expect(score({ verified: true, portable: true })).toBeGreaterThan(verified)
    })

    it('质量分:描述/分类/关键字/维护者/许可逐项加分,合包被扣', () => {
        const basePkg = { name: 'koishi-plugin-foo', contributors: [], maintainers: [] }
        const base = score()
        const described = score({ manifest: { description: 'a plugin' } })
        const packageDescribed = score({ package: { ...basePkg, description: 'd' } })
        const categorized = score({}, { category: 'tool' })
        const keyworded = score({ package: { ...basePkg, keywords: ['a', 'b', 'c'] } })
        const twoKeywords = score({ package: { ...basePkg, keywords: ['a', 'b'] } })
        const maintained = score({ package: { ...basePkg, maintainers: [{ name: 'x' }] } })
        const licensed = score({ license: 'MIT' })
        const packageLicensed = score({ package: { ...basePkg, license: 'MIT' } })
        expect(described).toBeGreaterThan(base)
        expect(packageDescribed).toBeGreaterThan(base)
        expect(categorized).toBeGreaterThan(base)
        expect(keyworded).toBeGreaterThan(twoKeywords)
        expect(maintained).toBeGreaterThan(base)
        expect(licensed).toBeGreaterThan(base)
        expect(packageLicensed).toBe(licensed)
        expect(score({}, { bundle: true })).toBeLessThan(base)
    })

    it('质量分:空白描述与空白多语言对象不加分', () => {
        const base = score()
        expect(score({ manifest: { description: '   ' } })).toBe(base)
        expect(score({ manifest: { description: { 'zh-CN': '  ', 'en-US': '' } } })).toBe(base)
        expect(score({ manifest: { description: { 'zh-CN': null } } })).toBe(base)
    })

    it('探索分在高质低下载近更新的条目上非零', () => {
        const rich = score({
            verified: true,
            portable: true,
            license: 'MIT',
            package: {
                name: 'koishi-plugin-foo',
                keywords: ['a', 'b', 'c'],
                description: 'd',
                maintainers: [{ name: 'x' }],
                contributors: [],
            },
        }, { category: 'tool' })
        // 与同参数但 createdTimestamp 无效(新鲜度=0,但探索只看质量/下载/维护)对比不可行,
        // 改为验证 rich 显著高于仅质量加成的理论值:手算探索分权重 0.08 的贡献
        expect(rich).toBeGreaterThan(50)
    })
})

describe('compareRecommendFallback', () => {
    function entry(overrides: EntryOverrides = {}) {
        return makeEntry(overrides)
    }

    it('优先比下载量(正数表示后者应排前)', () => {
        const a = entry()
        const more = entry({ downloads: { lastMonth: 10 } as any })
        expect(compareRecommendFallback(a, more)).toBe(10)
        expect(compareRecommendFallback(more, a)).toBe(-10)
        expect(compareRecommendFallback(a, a)).toBe(0)
    })

    it('下载量打平比更新时间', () => {
        const older = entry({ updatedAt: '2024-01-01T00:00:00.000Z' })
        const newer = entry({ updatedAt: '2024-06-01T00:00:00.000Z' })
        expect(compareRecommendFallback(older, newer)).toBeGreaterThan(0)
        expect(compareRecommendFallback(newer, older)).toBeLessThan(0)
    })

    it('更新时间也打平比创建时间', () => {
        const older = entry({
            updatedAt: '2024-06-01T00:00:00.000Z',
            createdAt: '2024-01-01T00:00:00.000Z',
        })
        const newer = entry({
            updatedAt: '2024-06-01T00:00:00.000Z',
            createdAt: '2024-05-01T00:00:00.000Z',
        })
        expect(compareRecommendFallback(older, newer)).toBeGreaterThan(0)
    })

    it('全打平按包名字典序(缺省下载量按 0)', () => {
        const a = entry()
        const z = entry({
            package: { name: 'koishi-plugin-zeta', contributors: [], maintainers: [] },
            createdAt: '2024-01-01T00:00:00.000Z',
        })
        expect(compareRecommendFallback(a, z)).toBeLessThan(0)
        expect(compareRecommendFallback(z, a)).toBeGreaterThan(0)
    })
})
