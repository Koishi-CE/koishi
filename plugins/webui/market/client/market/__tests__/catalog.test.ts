import { describe, expect, it } from 'vitest'

/**
 * @file 市场目录数据(徽章表/分类表/合包判定)的单元测试。
 *
 * 覆盖合包命名的两条识别路径、installed/portable 徽章的隐藏回调分支、
 * 徽章查询词/否定词成对性与 resolveCategory 的归类兜底。
 */

import {
    badges,
    canInstallBundleSearchObject,
    categories,
    isBundleSearchObject,
    resolveCategory,
} from '../catalog'
import { makeEntry, makeManifestEntry } from './helpers'

function withPackage(name: string, keywords?: string[]) {
    return makeEntry({
        package: { name, keywords, contributors: [], maintainers: [] },
    })
}

describe('isBundleSearchObject / canInstallBundleSearchObject', () => {
    it('合包命名或 market:package 关键字命中即判定为合包', () => {
        const keyworded = withPackage('koishi-plugin-foo', ['market:package'])
        const upperCased = withPackage('koishi-plugin-foo', ['Market:Package'])
        expect(isBundleSearchObject(withPackage('koishi-plugin-pa-suite'))).toBe(true)
        expect(isBundleSearchObject(withPackage('@scope/koishi-plugin-pa-suite'))).toBe(true)
        expect(isBundleSearchObject(keyworded)).toBe(true)
        expect(isBundleSearchObject(upperCased)).toBe(true)
        expect(isBundleSearchObject(makeManifestEntry())).toBe(false)
        expect(isBundleSearchObject(withPackage('koishi-plugin-payload'))).toBe(false)
        expect(isBundleSearchObject(withPackage('KOISHI-PLUGIN-PA-SUITE'))).toBe(false)
    })

    it('canInstallBundleSearchObject 与合包判定等价', () => {
        expect(canInstallBundleSearchObject(withPackage('koishi-plugin-pa-suite'))).toBe(true)
        expect(canInstallBundleSearchObject(makeManifestEntry())).toBe(false)
    })
})

describe('badges', () => {
    it('installed 徽章:未启用安装态或卡片场景隐藏', () => {
        expect(badges.installed!.hidden!({ installed: () => true }, 'filter')).toBe(false)
        expect(badges.installed!.hidden!({ installed: () => true }, 'card')).toBe(true)
        expect(badges.installed!.hidden!({}, 'filter')).toBe(true)
        expect(badges.installed!.hidden!({}, 'card')).toBe(true)
    })

    it('portable 徽章:未启用便携态或卡片场景隐藏', () => {
        expect(badges.portable!.hidden!({ portable: true }, 'filter')).toBe(false)
        expect(badges.portable!.hidden!({ portable: true }, 'card')).toBe(true)
        expect(badges.portable!.hidden!({}, 'filter')).toBe(true)
    })

    it('每枚徽章都有查询词与否定词,普通状态徽章不设图标', () => {
        for (const key of Object.keys(badges)) {
            expect(badges[key]!.query).toBeTruthy()
            expect(badges[key]!.negate).toBeTruthy()
        }
        expect(badges.bundle!.query).toBe('is:bundle')
        expect(badges.bundle!.icon).toBe('file-archive')
        expect(badges.verified!.icon).toBeUndefined()
    })

    it('newborn 徽章以一周前为分界构造查询词', () => {
        expect(badges.newborn!.query).toMatch(/^created:>\d{4}-\d{2}-\d{2}T/)
        expect(badges.newborn!.negate).toMatch(/^created:<\d{4}-\d{2}-\d{2}T/)
    })
})

describe('resolveCategory', () => {
    it('已知分类原样返回', () => {
        for (const name of categories) {
            expect(resolveCategory(name)).toBe(name)
        }
        expect(categories).toContain('adapter')
        expect(categories).not.toContain('other')
    })

    it('未知或缺省分类归入 other', () => {
        expect(resolveCategory('bogus')).toBe('other')
        expect(resolveCategory(undefined)).toBe('other')
    })
})
