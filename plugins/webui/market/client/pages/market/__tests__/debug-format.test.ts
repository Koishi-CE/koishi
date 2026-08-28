import { describe, expect, it } from 'vitest'

/**
 * @file 市场调试面板格式化函数的单元测试。
 *
 * t 用恒等函数注入,聚焦验证体积/评分/编码/压缩比/端点截断/阶段拼接的
 * 纯格式逻辑。
 */

import {
  formatCompressionRatio,
  formatDebugPhase,
  formatDuration,
  formatEncoding,
  formatFallbackReason,
  formatNumber,
  formatScore,
  formatSize,
  formatSource,
  formatTimingName,
  shortEndpoint,
} from '../debug-format'

const t = (key: string) => key

describe('体积与数值', () => {
    it('字节数按 B/KB/MB 分档,空值显示 -', () => {
        expect(formatSize(undefined)).toBe('-')
        expect(formatSize(512)).toBe('512B')
        expect(formatSize(2048)).toBe('2.0KB')
        expect(formatSize(3 * 1024 * 1024)).toBe('3.00MB')
    })

    it('评分保留一位小数,数字千分位,空值 -', () => {
        expect(formatScore(undefined)).toBe('-')
        expect(formatScore(3.14159)).toBe('3.1')
        expect(formatNumber(undefined)).toBe('-')
        expect(formatNumber(12345)).toBe('12,345')
    })

    it('耗时取整为毫秒', () => {
        expect(formatDuration(12.6)).toBe('13ms')
    })
})

describe('枚举翻译', () => {
    it('数据来源枚举翻译,未知值原样返回', () => {
        expect(formatSource('network', t)).toBe('marketPage.debug.sourceNetwork')
        expect(formatSource('weird', t)).toBe('weird')
        expect(formatSource(undefined, t)).toBe('marketPage.debug.unknown')
    })

    it('耗时项 key 翻译,未知 key 原样返回', () => {
        expect(formatTimingName('frontendSort', t)).toBe('marketPage.debug.frontendSort')
        expect(formatTimingName('hash', t)).toBe('Hash')
        expect(formatTimingName('mystery', t)).toBe('mystery')
    })

    it('端点回退原因枚举翻译', () => {
        expect(formatFallbackReason('primary-failed', t)).toBe('marketPage.debug.primaryFailed')
        expect(formatFallbackReason(undefined, t)).toBe('-')
    })

    it('内容编码缺省 identity', () => {
        expect(formatEncoding(undefined)).toBe('identity')
        expect(formatEncoding('br')).toBe('br')
    })
})

describe('压缩比与端点', () => {
    it('压缩比:未压缩显示占位,压缩显示倍率', () => {
        expect(formatCompressionRatio(undefined, 100, t)).toBe('-')
        expect(formatCompressionRatio(200, 300, t)).toBe('marketPage.debug.uncompressed')
        expect(formatCompressionRatio(300, 100, t)).toBe('3.0x')
    })

    it('端点 URL 只显示主机名,解析失败原样返回', () => {
        expect(shortEndpoint(undefined)).toBe('-')
        expect(shortEndpoint('https://registry.npmmirror.com/x')).toBe('registry.npmmirror.com')
        expect(shortEndpoint('not-url')).toBe('not-url')
    })
})

describe('阶段概览拼接', () => {
    it('来源/端点/原因/耗时/编码/体积按序拼接,空段丢弃', () => {
        expect(formatDebugPhase({ source: 'network', endpoint: 'https://r.example.com' }, t))
            .toBe('marketPage.debug.sourceNetwork / r.example.com')
        expect(formatDebugPhase({
            source: 'disk-cache',
            endpoint: 'https://r.example.com',
            fallbackReason: 'primary-failed',
            timings: { total: 1200 },
            contentEncoding: 'br',
            wireSize: 4096,
        }, t)).toBe([
            'marketPage.debug.sourceDiskCache',
            'r.example.com',
            'marketPage.debug.primaryFailed',
            '1200ms',
            'br',
            '4.0KB',
        ].join(' / '))
    })
})
