import { describe, expect, it } from 'vitest'

/**
 * @file 市场查询词校验与过滤的单元测试。
 *
 * 全链路纯函数(无 @koishi-ce/client 依赖),聚焦 validate 的查询词判定矩阵
 * (is:/not:/日期/时间窗/元数据/纯文本相似度)与 getVisible/getFiltered/
 * getSilentFiltered 的批量行为。
 */

import {
    getFiltered,
    getSilentFiltered,
    getVisible,
    hasFilter,
    parseSilentFilters,
    validate,
    validateWord,
} from '../filter'

/** 构造最小市场条目;默认无 manifest(走无 manifest 分支)。 */
function makeEntry(overrides: Record<string, any> = {}) {
  return {
    package: { name: 'koishi-plugin-foo', contributors: [], maintainers: [] },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-06-01T00:00:00.000Z',
    ...overrides,
  } as any
}

/** 带 manifest 的条目(impl/locale/using/category/is: 状态等查询走这个分支)。 */
function makeManifestEntry(overrides: Record<string, any> = {}) {
  return makeEntry({
    verified: false,
    insecure: false,
    portable: false,
    manifest: {
      locales: ['zh-CN'],
      service: { implements: ['dice'], required: ['database'], optional: ['canvas'] },
    },
    ...overrides,
  })
}

describe('validateWord / hasFilter / parseSilentFilters', () => {
    it('合法操作符与裸词通过,未知操作符拒绝', () => {
        expect(validateWord('is:installed')).toBe(true)
        expect(validateWord('foo')).toBe(true)
        expect(validateWord('bogus:x')).toBe(false)
    })

    it('hasFilter 只统计非 show:/sort:/limit: 的词', () => {
        expect(hasFilter(['show:hidden', 'sort:download'])).toBe(false)
        expect(hasFilter(['show:hidden', 'is:verified'])).toBe(true)
        expect(hasFilter([''])).toBe(false)
    })

    it('静音词解析支持多行与中英文分隔符', () => {
        expect(parseSilentFilters('is:preview\nupdated:within:30, foo；bar')).toEqual([
            'is:preview',
            'updated:within:30',
            'foo',
            'bar',
        ])
        expect(parseSilentFilters(['a', 'b'])).toEqual(['a', 'b'])
        expect(parseSilentFilters()).toEqual([])
    })
})

describe('validate 查询词判定', () => {
    it('is:/not: 状态查询按条目标志判定', () => {
        const entry = makeManifestEntry({ verified: true })
        expect(validate(entry, 'is:verified')).toBe(true)
        expect(validate(entry, 'not:verified')).toBe(false)
        expect(validate(entry, 'is:insecure')).toBe(false)
    })

    it('is:installed 走 config.installed 回调', () => {
        const entry = makeEntry()
        expect(validate(entry, 'is:installed', { installed: () => true })).toBe(true)
        expect(validate(entry, 'is:installed')).toBe(false)
    })

    it('created/updated 日期比较含边界', () => {
        const entry = makeEntry()
        expect(validate(entry, 'created:<2024-03-01')).toBe(true)
        expect(validate(entry, 'created:>2024-03-01')).toBe(false)
        expect(validate(entry, 'updated:>=2024-06-01')).toBe(true)
        expect(validate(entry, 'updated:<=2024-05-31')).toBe(false)
    })

    it('within:N 时间窗按当前时间判定', () => {
        const entry = makeEntry()
        expect(validate(entry, 'created:within:100000')).toBe(true)
        expect(validate(entry, 'created:within:10')).toBe(false)
    })

    it('impl/locale/using/category 查 manifest 元数据', () => {
        const entry = makeManifestEntry()
        expect(validate(entry, 'impl:dice')).toBe(true)
        expect(validate(entry, 'impl:none')).toBe(false)
        expect(validate(entry, 'locale:zh-CN')).toBe(true)
        expect(validate(entry, 'using:database')).toBe(true)
        expect(validate(entry, 'using:canvas')).toBe(true)
        expect(validate(entry, 'category:other')).toBe(true)
    })

    it('email 查 config.users 的邮箱', () => {
        const entry = makeManifestEntry()
        const users = [{ name: 'a', email: 'Dev@Example.com' }] as any
        expect(validate(entry, 'email:dev@example.com', { users })).toBe(true)
        expect(validate(entry, 'email:other@example.com', { users })).toBe(false)
    })

    it('纯文本走包名相似度', () => {
        const entry = makeEntry()
        expect(validate(entry, 'foo')).toBe(true)
        expect(validate(entry, 'zzz')).toBe(false)
    })

    it('无 manifest 时 is:/not: 只支持 installed/bundle', () => {
        const entry = makeEntry()
        expect(validate(entry, 'is:verified')).toBe(false)
        expect(validate(entry, 'not:verified')).toBe(true)
        expect(validate(entry, 'is:bundle')).toBe(false)
        expect(validate(entry, 'not:bundle')).toBe(true)
        expect(validate(entry, 'not:installed', { installed: () => true })).toBe(false)
    })
})

describe('getVisible / getFiltered / getSilentFiltered', () => {
    it('getVisible 滤隐藏/弃用条目,show: 前缀放行', () => {
        const hidden = makeEntry({ manifest: { hidden: true } })
        const normal = makeEntry()
        expect(getVisible([hidden, normal], [])).toEqual([normal])
        expect(getVisible([hidden, normal], ['show:hidden'])).toEqual([hidden, normal])
    })

    it('getVisible 对弃用条目放行需 show:deprecated,market 缺省安全', () => {
        const deprecated = makeEntry({ deprecated: true })
        const normal = makeEntry()
        expect(getVisible([deprecated, normal], [])).toEqual([normal])
        expect(getVisible([deprecated, normal], ['show:deprecated'])).toEqual([deprecated, normal])
        expect(getVisible(undefined as any, [])).toBeUndefined()
    })

    it('getFiltered 保留全部查询词命中的条目', () => {
        const verified = makeManifestEntry({ verified: true })
        const plain = makeManifestEntry()
        expect(getFiltered([verified, plain], ['is:verified'])).toEqual([verified])
        expect(getFiltered([verified, plain], [])).toEqual([verified, plain])
    })

    it('getFiltered 多查询词取交集', () => {
        const hit = makeManifestEntry({ verified: true, insecure: true })
        const verifiedOnly = makeManifestEntry({ verified: true })
        expect(getFiltered([hit, verifiedOnly], ['is:verified'])).toEqual([hit, verifiedOnly])
        expect(getFiltered([hit, verifiedOnly], ['is:verified', 'is:insecure'])).toEqual([hit])
    })

    it('getSilentFiltered 排除任一命中的条目', () => {
        const verified = makeManifestEntry({ verified: true })
        const plain = makeManifestEntry()
        expect(getSilentFiltered([verified, plain], ['is:verified'])).toEqual([plain])
    })

    it('归一后为空的查询词直接返回原列表', () => {
        const market = [makeEntry()]
        expect(getFiltered(market, ['  ', ''])).toBe(market)
        expect(getSilentFiltered(market, ['  ', ''])).toBe(market)
    })
})

describe('validate 错误路径与边界补充', () => {
    it('updated: 前缀四种比较符', () => {
        const entry = makeEntry()
        expect(validate(entry, 'updated:<2024-07-01')).toBe(true)
        expect(validate(entry, 'updated:>2024-05-01')).toBe(true)
        expect(validate(entry, 'updated:<=2024-06-01')).toBe(true)
        expect(validate(entry, 'updated:>=2024-06-01')).toBe(true)
        expect(validate(entry, 'updated:<2024-05-01')).toBe(false)
    })

    it('created 前缀四种比较符含边界', () => {
        const entry = makeEntry()
        expect(validate(entry, 'created:<=2024-01-01')).toBe(true)
        expect(validate(entry, 'created:>=2024-01-01')).toBe(true)
        expect(validate(entry, 'created:<=2023-12-31')).toBe(false)
        expect(validate(entry, 'created:>=2024-01-02')).toBe(false)
    })

    it('完整 ISO 时间戳查询直接按 Date.parse 解析', () => {
        const entry = makeEntry()
        expect(validate(entry, 'created:<2024-03-01T12:00:00.000Z')).toBe(true)
        expect(validate(entry, 'created:>2024-03-01T12:00:00.000Z')).toBe(false)
    })

    it('条目时间无效时日期比较回退到字符串比较(四操作符)', () => {
        const entry = makeEntry({ updatedAt: 'not-a-date', createdAt: 'not-a-date' })
        expect(validate(entry, 'updated:<zzz')).toBe(true)
        expect(validate(entry, 'updated:<=zzz')).toBe(true)
        expect(validate(entry, 'updated:>zzz')).toBe(false)
        expect(validate(entry, 'updated:>=zzz')).toBe(false)
    })

    it('查询日期无效时同样回退到字符串比较', () => {
        const entry = makeEntry()
        expect(validate(entry, 'created:<bogus')).toBe(true)
        expect(validate(entry, 'created:>bogus')).toBe(false)
    })

    it('within:N:查询非 1-4 位数字放行,时间无效拒绝', () => {
        const entry = makeEntry({ createdAt: 'nope', updatedAt: 'nope' })
        expect(validate(entry, 'created:within:abc')).toBe(true)
        expect(validate(entry, 'created:within:100000')).toBe(true)
        expect(validate(entry, 'updated:within:30')).toBe(false)
    })

    it('is:preview / not:preview / is:portable / not:portable / not:insecure', () => {
        const entry = makeManifestEntry({
            portable: true,
            manifest: {
                locales: [],
                service: { implements: [], required: [], optional: [] },
                preview: true,
            },
        })
        expect(validate(entry, 'is:preview')).toBe(true)
        expect(validate(entry, 'not:preview')).toBe(false)
        expect(validate(entry, 'is:portable')).toBe(true)
        expect(validate(entry, 'not:portable')).toBe(false)
        expect(validate(entry, 'not:insecure')).toBe(true)
    })

    it('is:installed / not:installed 有 manifest 时也走 config 回调', () => {
        const entry = makeManifestEntry()
        expect(validate(entry, 'is:installed', { installed: () => true })).toBe(true)
        expect(validate(entry, 'not:installed', { installed: () => true })).toBe(false)
        expect(validate(entry, 'not:installed')).toBe(true)
    })

    it('未知 is:/not: 值:is 一律否决,not 一律放行', () => {
        const entry = makeManifestEntry()
        expect(validate(entry, 'is:bogus')).toBe(false)
        expect(validate(entry, 'not:bogus')).toBe(true)
        expect(validate(entry, 'is:bundle')).toBe(false)
        expect(validate(entry, 'not:bundle')).toBe(true)
    })

    it('未知冒号前缀的词按中性词放行(有/无 manifest)', () => {
        expect(validate(makeManifestEntry(), 'foo:bar')).toBe(true)
        expect(validate(makeEntry(), 'foo:bar')).toBe(true)
    })

    it('email 未显式传 users 时回退到条目作者列表', () => {
        const author = { name: 'dev', email: 'Dev@Example.com' }
        const entry = makeManifestEntry({
            package: {
                name: 'koishi-plugin-foo',
                contributors: [author],
                maintainers: [author],
            },
        })
        expect(validate(entry, 'email:dev@example.com')).toBe(true)
        expect(validate(entry, 'email:other@example.com')).toBe(false)
    })
})
