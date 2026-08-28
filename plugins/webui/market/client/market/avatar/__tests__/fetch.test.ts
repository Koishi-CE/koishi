import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * @file 头像实际抓取与缓存回填(fetch.ts)的单元测试。
 *
 * mock @koishi-ce/client 的 send(可编程成功/失败/挂起),真实使用 cache 模块。
 * 覆盖:data: URI 透传、缓存命中、成功写缓存、失败按 cacheFailure 标记、
 * RPC 无结果、缺 type 的失败、按 cacheKey 的单飞去重与 key 归一化。
 */

const client = vi.hoisted(() => ({
    send: vi.fn(),
}))

vi.mock('@koishi-ce/client', () => ({
    send: client.send,
}))

import { isAvatarFailureCached, resetAvatarCachesForTest } from '../cache'
import { fetchAndCacheAvatar, fetchCachedAvatar } from '../fetch'

const URL_ADDRESS = 'https://example.com/a.png'

beforeEach(() => {
    client.send.mockReset()
    resetAvatarCachesForTest()
})

describe('fetchAndCacheAvatar', () => {
    it('data: URI 直接返回,不发 RPC', async () => {
        const dataUri = 'data:image/png;base64,zz'
        await expect(fetchAndCacheAvatar('key', dataUri)).resolves.toBe(dataUri)
        expect(client.send).not.toHaveBeenCalled()
    })

    it('成功结果写入缓存,后续调用直接命中', async () => {
        client.send.mockResolvedValueOnce({ data: 'aGk=', type: 'image/png' })
        const expected = 'data:image/png;base64,aGk='
        await expect(fetchAndCacheAvatar('key', URL_ADDRESS)).resolves.toBe(expected)
        expect(client.send).toHaveBeenCalledWith('market/avatar', 'key', URL_ADDRESS)
        await expect(fetchAndCacheAvatar('key', URL_ADDRESS)).resolves.toBe(expected)
        expect(client.send).toHaveBeenCalledTimes(1)
        expect(isAvatarFailureCached('key')).toBe(false)
    })

    it('cacheFailure=true 时失败写入失败缓存', async () => {
        client.send.mockRejectedValueOnce(new Error('network'))
        await expect(fetchAndCacheAvatar('key', URL_ADDRESS)).resolves.toBe('')
        expect(isAvatarFailureCached('key')).toBe(true)
    })

    it('cacheFailure=false 时失败不记录(浏览器已展示成功)', async () => {
        client.send.mockRejectedValueOnce(new Error('network'))
        await expect(fetchAndCacheAvatar('key', URL_ADDRESS, false)).resolves.toBe('')
        expect(isAvatarFailureCached('key')).toBe(false)
    })

    it('RPC 无结果或缺 type 按失败处理', async () => {
        client.send.mockResolvedValueOnce(undefined)
        await expect(fetchAndCacheAvatar('key', URL_ADDRESS)).resolves.toBe('')
        client.send.mockResolvedValueOnce({ data: 'aGk=' })
        await expect(fetchAndCacheAvatar('key2', URL_ADDRESS)).resolves.toBe('')
        expect(isAvatarFailureCached('key2')).toBe(true)
    })

    it('send 同步返回 undefined(非 Promise)同样按无结果处理', async () => {
        client.send.mockReturnValueOnce(undefined as any)
        await expect(fetchAndCacheAvatar('key', URL_ADDRESS)).resolves.toBe('')
        client.send.mockReturnValueOnce(undefined as any)
        await expect(fetchCachedAvatar('key2')).resolves.toBe('')
        expect(client.send).toHaveBeenCalledTimes(2)
    })

    it('并发同 key 单飞:只发一次 RPC,完成后清出进行中表', async () => {
        let resolveSend!: (value: any) => void
        client.send.mockImplementationOnce(() => new Promise(resolve => (resolveSend = resolve)))
        const first = fetchAndCacheAvatar('key', URL_ADDRESS)
        const second = fetchAndCacheAvatar('key', URL_ADDRESS)
        expect(client.send).toHaveBeenCalledTimes(1)
        resolveSend({ data: 'aGk=', type: 'image/png' })
        const [a, b] = await Promise.all([first, second])
        expect(a).toBe(b)
        // 完成后再次并发是新一轮请求(缓存已命中则不发)
        await expect(fetchAndCacheAvatar('key', URL_ADDRESS)).resolves.toBe(a)
        expect(client.send).toHaveBeenCalledTimes(1)
    })

    it('cacheKey 归一化后共享缓存条目', async () => {
        client.send.mockResolvedValueOnce({ data: 'aGk=', type: 'image/png' })
        await fetchAndCacheAvatar('k 1', URL_ADDRESS)
        client.send.mockResolvedValueOnce({ data: 'Yg==', type: 'image/png' })
        const expected = 'data:image/png;base64,aGk='
        // 'k/1' 与 'k 1' 都归一为 'k-1' → 命中同一条缓存,不发新请求
        await expect(fetchAndCacheAvatar('k/1', URL_ADDRESS)).resolves.toBe(expected)
        expect(client.send).toHaveBeenCalledTimes(1)
    })
})

describe('fetchCachedAvatar', () => {
    it('data: URI 直接透传', async () => {
        const dataUri = 'data:image/png;base64,zz'
        await expect(fetchCachedAvatar(dataUri)).resolves.toBe(dataUri)
        expect(client.send).not.toHaveBeenCalled()
    })

    it('成功回放写缓存,失败静默返回空串且不记失败', async () => {
        client.send.mockResolvedValueOnce({ data: 'aGk=', type: 'image/png' })
        await expect(fetchCachedAvatar('key')).resolves.toBe('data:image/png;base64,aGk=')
        client.send.mockRejectedValueOnce(new Error('network'))
        await expect(fetchCachedAvatar('key2')).resolves.toBe('')
        client.send.mockResolvedValueOnce(undefined)
        await expect(fetchCachedAvatar('key3')).resolves.toBe('')
        expect(isAvatarFailureCached('key2')).toBe(false)
        expect(isAvatarFailureCached('key3')).toBe(false)
    })

    it('单飞 key 与 fetchAndCacheAvatar 相互独立(cache: 前缀)', async () => {
        let resolveSend!: (value: any) => void
        client.send.mockImplementationOnce(() => new Promise(resolve => (resolveSend = resolve)))
        const first = fetchCachedAvatar('key')
        const second = fetchCachedAvatar('key')
        expect(client.send).toHaveBeenCalledTimes(1)
        resolveSend({ data: 'aGk=', type: 'image/png' })
        const [a, b] = await Promise.all([first, second])
        expect(a).toBe(b)
        await expect(fetchCachedAvatar('key')).resolves.toBe(a)
        expect(client.send).toHaveBeenCalledTimes(1)
    })
})
