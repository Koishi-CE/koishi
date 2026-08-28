import { describe, expect, it, vi } from 'vitest'

/**
 * @file market/avatar 域聚合出口(avatar/index.ts)的单元测试。
 *
 * mock @koishi-ce/client(fetch 子模块依赖 send),验证聚合导出的每个符号
 * 与各子模块逐一同一,防止拆分后的 re-export 面漏发。
 */

const client = vi.hoisted(() => ({
    send: vi.fn(),
}))

vi.mock('@koishi-ce/client', () => ({
    send: client.send,
}))

describe('avatar 聚合出口', () => {
    it('re-export 的符号与各子模块逐一同一', async () => {
        const avatar = await import('../index')
        const cache = await import('../cache')
        const candidates = await import('../candidates')
        const fetch = await import('../fetch')

        expect(avatar.getUserAvatarCandidates).toBe(candidates.getUserAvatarCandidates)
        expect(avatar.getCachedAvatarFromCandidates).toBe(cache.getCachedAvatarFromCandidates)
        expect(avatar.cacheAvatarFailure).toBe(cache.cacheAvatarFailure)
        expect(avatar.isAvatarFailureCached).toBe(cache.isAvatarFailureCached)
        expect(avatar.fetchAndCacheAvatar).toBe(fetch.fetchAndCacheAvatar)
        expect(avatar.fetchCachedAvatar).toBe(fetch.fetchCachedAvatar)
    })
})
