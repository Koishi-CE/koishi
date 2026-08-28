import { describe, expect, it } from 'vitest'

/**
 * @file 市场条目排序的单元测试。
 *
 * 覆盖:download/created/updated 比较器、sort: 前缀与 -asc/-desc 后缀解析、
 * 非法排序键回落 default、default 按搜索分 × 排名分、recommend 打分排序
 * 与打平回退,以及已装条目降权对 recommend 排序的影响。
 */

import { comparators, getSortedPrepared } from '../sort'
import { makeEntry, type EntryOverrides } from './helpers'

function entry(overrides: EntryOverrides = {}) {
    return makeEntry(overrides)
}

const alpha = entry({
    package: { name: 'koishi-plugin-alpha', contributors: [], maintainers: [] },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-03-01T00:00:00.000Z',
    downloads: { lastMonth: 10 } as any,
})
const beta = entry({
    package: { name: 'koishi-plugin-beta', contributors: [], maintainers: [] },
    createdAt: '2024-05-01T00:00:00.000Z',
    updatedAt: '2024-06-01T00:00:00.000Z',
    downloads: { lastMonth: 100 } as any,
})
const gamma = entry({
    package: { name: 'koishi-plugin-gamma', contributors: [], maintainers: [] },
    createdAt: '2023-01-01T00:00:00.000Z',
    updatedAt: '2023-02-01T00:00:00.000Z',
})

const names = (market: any[]) => market.map(item => item.package.name)

describe('comparators', () => {
    it('download/created/updated 的直接比较', () => {
        expect(comparators.download.compare!(alpha, beta, [])).toBe(90)
        expect(comparators.download.compare!(beta, alpha, [])).toBe(-90)
        expect(comparators.created.compare!(alpha, beta, [])).toBeGreaterThan(0)
        expect(comparators.updated.compare!(alpha, beta, [])).toBeGreaterThan(0)
        expect(comparators.default.icon).toBe('solid:all')
        expect(comparators.recommend.icon).toBe('award')
    })

    it('default.compare 按搜索分比较,零搜索分回退更新时间', () => {
        const compare = comparators.default.compare!
        expect(compare(alpha, beta, ['beta'])).toBeGreaterThan(0)
        expect(compare(beta, alpha, ['beta'])).toBeLessThan(0)
        // 两个词都不命中时搜索分同为 0,回退到更新时间字符串比较
        expect(compare(alpha, beta, ['zzz'])).toBe(
            '2024-06-01T00:00:00.000Z'.localeCompare('2024-03-01T00:00:00.000Z'),
        )
        expect(comparators.recommend.compare).toBeUndefined()
    })

    it('download 比较对缺省下载量按 0 处理', () => {
        expect(comparators.download.compare!(alpha, gamma, [])).toBe(-10)
        expect(comparators.download.compare!(gamma, gamma, [])).toBe(0)
    })
})

describe('getSortedPrepared', () => {
    it('default 无搜索词按市场排名(更新时间)降序', () => {
        expect(names(getSortedPrepared([alpha, gamma, beta], []))).toEqual([
            'koishi-plugin-beta',
            'koishi-plugin-alpha',
            'koishi-plugin-gamma',
        ])
    })

    it('default 带搜索词把命中条目提前', () => {
        expect(names(getSortedPrepared([alpha, beta], ['gamma']))).toEqual([
            'koishi-plugin-beta',
            'koishi-plugin-alpha',
        ])
        expect(names(getSortedPrepared([alpha, gamma], ['gamma']))).toEqual([
            'koishi-plugin-gamma',
            'koishi-plugin-alpha',
        ])
    })

    it('sort:download / sort:created / sort:updated 切换排序键', () => {
        expect(names(getSortedPrepared([alpha, beta, gamma], ['sort:download']))).toEqual([
            'koishi-plugin-beta',
            'koishi-plugin-alpha',
            'koishi-plugin-gamma',
        ])
        expect(names(getSortedPrepared([alpha, beta, gamma], ['sort:created']))).toEqual([
            'koishi-plugin-beta',
            'koishi-plugin-alpha',
            'koishi-plugin-gamma',
        ])
        expect(names(getSortedPrepared([alpha, beta, gamma], ['sort:updated']))).toEqual([
            'koishi-plugin-beta',
            'koishi-plugin-alpha',
            'koishi-plugin-gamma',
        ])
    })

    it('-asc/-desc 后缀控制方向', () => {
        expect(names(getSortedPrepared([alpha, beta, gamma], ['sort:download-asc']))).toEqual([
            'koishi-plugin-gamma',
            'koishi-plugin-alpha',
            'koishi-plugin-beta',
        ])
        expect(names(getSortedPrepared([alpha, beta, gamma], ['sort:download-desc']))).toEqual([
            'koishi-plugin-beta',
            'koishi-plugin-alpha',
            'koishi-plugin-gamma',
        ])
    })

    it('非法排序键回落 default,多个 sort: 词取第一个有效的', () => {
        expect(names(getSortedPrepared([alpha, beta], ['sort:bogus']))).toEqual([
            'koishi-plugin-beta',
            'koishi-plugin-alpha',
        ])
        const sorted = getSortedPrepared([alpha, beta, gamma], ['sort:bogus', 'sort:created-asc'])
        expect(names(sorted)).toEqual([
            'koishi-plugin-gamma',
            'koishi-plugin-alpha',
            'koishi-plugin-beta',
        ])
    })

    it('sort:recommend 按推荐分排序,-asc 反向', () => {
        expect(names(getSortedPrepared([gamma, alpha, beta], ['sort:recommend']))).toEqual([
            'koishi-plugin-beta',
            'koishi-plugin-alpha',
            'koishi-plugin-gamma',
        ])
        expect(names(getSortedPrepared([gamma, alpha, beta], ['sort:recommend-asc']))).toEqual([
            'koishi-plugin-gamma',
            'koishi-plugin-alpha',
            'koishi-plugin-beta',
        ])
    })

    it('recommend 打平时回退到下载量/时间/包名比较', () => {
        const a = entry({
            package: { name: 'koishi-plugin-aaa', maintainers: [], contributors: [] },
        })
        const z = entry({
            package: { name: 'koishi-plugin-zzz', maintainers: [], contributors: [] },
        })
        // 两条目除包名外完全一致 → 推荐分相同 → 回退链最终按包名字典序
        expect(names(getSortedPrepared([z, a], ['sort:recommend']))).toEqual([
            'koishi-plugin-aaa',
            'koishi-plugin-zzz',
        ])
    })

    it('recommend 排序受 config.installed 降权影响', () => {
        const plain = entry({
            package: { name: 'koishi-plugin-plain', contributors: [], maintainers: [] },
            createdAt: '2024-05-01T00:00:00.000Z',
            updatedAt: '2024-06-01T00:00:00.000Z',
            downloads: { lastMonth: 10 } as any,
        })
        const installed = entry({
            package: { name: 'koishi-plugin-installed', contributors: [], maintainers: [] },
            createdAt: '2024-05-01T00:00:00.000Z',
            updatedAt: '2024-06-01T00:00:00.000Z',
            downloads: { lastMonth: 1000 } as any,
        })
        const config = { installed: (data: any) => data.package.name === 'koishi-plugin-installed' }
        expect(names(getSortedPrepared([installed, plain], ['sort:recommend']))).toEqual([
            'koishi-plugin-installed',
            'koishi-plugin-plain',
        ])
        expect(names(getSortedPrepared([installed, plain], ['sort:recommend'], config))).toEqual([
            'koishi-plugin-plain',
            'koishi-plugin-installed',
        ])
    })

    it('空市场与不复制原数组', () => {
        expect(getSortedPrepared([], ['sort:download'])).toEqual([])
        const source = [alpha, beta]
        getSortedPrepared(source, ['sort:download-asc'])
        expect(names(source)).toEqual(['koishi-plugin-alpha', 'koishi-plugin-beta'])
    })
})
