import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * @file 头像双缓存 TTL 判定的单元测试。
 *
 * 用假时钟精确控制 24h 成功缓存与 10min 失败缓存的过期行为,以及
 * 候选链上的缓存命中顺序。
 */

import type { AvatarCandidate } from '../candidates'
import {
  AVATAR_FAILURE_TTL,
  cacheAvatar,
  cacheAvatarFailure,
  getCachedAvatar,
  getCachedAvatarFromCandidates,
  isAvatarFailureCached,
  resetAvatarCachesForTest,
} from '../cache'

const DAY_MS = 1000 * 60 * 60 * 24

function candidate(cacheKey: string): AvatarCandidate {
  return { url: `https://example.com/${cacheKey}.png`, source: 'explicit', cacheKey }
}

beforeEach(() => {
  vi.useFakeTimers()
  resetAvatarCachesForTest()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('失败缓存', () => {
  it('失败后处于冷却期,10 分钟后过期自动放行', () => {
    cacheAvatarFailure('url:bad')
    expect(isAvatarFailureCached('url:bad')).toBe(true)
    vi.setSystemTime(Date.now() + AVATAR_FAILURE_TTL - 1)
    expect(isAvatarFailureCached('url:bad')).toBe(true)
    vi.setSystemTime(Date.now() + 2)
    expect(isAvatarFailureCached('url:bad')).toBe(false)
  })

  it('写入成功缓存会清掉同 key 的失败标记', () => {
    cacheAvatarFailure('url:good')
    cacheAvatar('url:good', { data: 'aGk=', type: 'image/png', cachedAt: Date.now() })
    expect(isAvatarFailureCached('url:good')).toBe(false)
  })

  it('data: URI 无失败语义', () => {
    cacheAvatarFailure('data:image/png;base64,xxx')
    expect(isAvatarFailureCached('data:image/png;base64,xxx')).toBe(false)
  })
})

describe('成功缓存', () => {
  it('命中返回 data: URI,24 小时后过期清除', () => {
    cacheAvatar('url:hit', { data: 'aGk=', type: 'image/png', cachedAt: Date.now() })
    expect(getCachedAvatar('url:hit')).toBe('data:image/png;base64,aGk=')
    vi.setSystemTime(Date.now() + DAY_MS - 1)
    expect(getCachedAvatar('url:hit')).toBe('data:image/png;base64,aGk=')
    vi.setSystemTime(Date.now() + 2)
    expect(getCachedAvatar('url:hit')).toBeUndefined()
  })

  it('data: URI 直接透传,不占缓存', () => {
    expect(getCachedAvatar('data:image/png;base64,zz')).toBe('data:image/png;base64,zz')
  })

    it('getCachedAvatarFromCandidates 沿链返回第一个命中', () => {
        cacheAvatar('key-2', { data: 'Yg==', type: 'image/png', cachedAt: Date.now() })
        const chain = [candidate('key-1'), candidate('key-2'), candidate('key-3')]
        const result = getCachedAvatarFromCandidates(chain)
        expect(result).toBe('data:image/png;base64,Yg==')
        expect(getCachedAvatarFromCandidates([candidate('key-1')])).toBeUndefined()
    })

    it('多条缓存触发裁剪排序,均未过期时全部保留', () => {
        cacheAvatar('k-old', { data: 'aGk=', type: 'image/png', cachedAt: Date.now() - 10 })
        cacheAvatar('k-new', { data: 'Yg==', type: 'image/png', cachedAt: Date.now() })
        expect(getCachedAvatar('k-old')).toBe('data:image/png;base64,aGk=')
        expect(getCachedAvatar('k-new')).toBe('data:image/png;base64,Yg==')
        cacheAvatarFailure('f-old')
        cacheAvatarFailure('f-new')
        expect(isAvatarFailureCached('f-old')).toBe(true)
        expect(isAvatarFailureCached('f-new')).toBe(true)
    })

    it('空 cacheKey 退化为 md5 形态仍可命中', () => {
        cacheAvatar('', { data: 'aGk=', type: 'image/png', cachedAt: Date.now() })
        expect(getCachedAvatar('')).toBe('data:image/png;base64,aGk=')
        cacheAvatarFailure('')
        expect(isAvatarFailureCached('')).toBe(true)
    })

    it('成功缓存超过 256 条按最新优先裁剪', () => {
        const base = Date.now()
        for (let i = 0; i < 258; i++) {
            vi.setSystemTime(base + i)
            cacheAvatar(`over-${i}`, { data: 'aGk=', type: 'image/png', cachedAt: Date.now() })
        }
        expect(getCachedAvatar('over-0')).toBeUndefined()
        expect(getCachedAvatar('over-1')).toBeUndefined()
        expect(getCachedAvatar('over-257')).toBe('data:image/png;base64,aGk=')
    })

    it('失败缓存超过 256 条按最新优先裁剪', () => {
        const base = Date.now()
        for (let i = 0; i < 258; i++) {
            vi.setSystemTime(base + i)
            cacheAvatarFailure(`over-f-${i}`)
        }
        expect(isAvatarFailureCached('over-f-0')).toBe(false)
        expect(isAvatarFailureCached('over-f-257')).toBe(true)
    })
})
