import type { SearchObject } from '@koishi-ce/registry'
import type { MarketSearchIndex } from '../similarity'

/**
 * @file market 域测试的公共工厂与工具。
 *
 * - makeEntry/makeManifestEntry:构造最小可用的市场条目(默认无 manifest,
 *   覆盖无 manifest 的查询分支);
 * - makeIndex:构造与 getSearchIndex 输出字段对齐的打分索引;
 * - resetStore:清空 @koishi-ce/client mock 里 store 的全部键(保持对象
 *   引用不变,vi.mock 工厂引用的仍是同一个对象)。
 */

/** 测试覆盖项:浅合并进工厂默认值。 */
export type EntryOverrides = Record<string, any>

/** 最小市场条目;默认无 manifest(覆盖无 manifest 的查询分支)。 */
export function makeEntry(overrides: EntryOverrides = {}): SearchObject {
    return {
        package: { name: 'koishi-plugin-foo', contributors: [], maintainers: [] },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-06-01T00:00:00.000Z',
        ...overrides,
    } as SearchObject
}

/** 带 manifest 的条目(impl/locale/using/is: 等元数据查询走这个分支)。 */
export function makeManifestEntry(overrides: EntryOverrides = {}): SearchObject {
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

/** 打分索引:字段与 getSearchIndex 输出对齐,缺省给可解析的日期。 */
export function makeIndex(overrides: EntryOverrides = {}): MarketSearchIndex {
    return {
        users: [],
        normalizedName: 'foo',
        searchTexts: [],
        category: 'other',
        bundle: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-06-01T00:00:00.000Z',
        createdTimestamp: Date.parse('2024-01-01T00:00:00.000Z'),
        updatedTimestamp: Date.parse('2024-06-01T00:00:00.000Z'),
        ...overrides,
    }
}

/** 清空 mock store 的全部键(引用保持不变,vi.mock 工厂继续指向同一对象)。 */
export function resetStore(store: Record<string, any>) {
    for (const key of Object.keys(store)) delete store[key]
}
