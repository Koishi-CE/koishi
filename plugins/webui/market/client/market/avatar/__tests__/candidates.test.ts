import { beforeEach, describe, expect, it } from 'vitest'

/**
 * @file 头像候选链生成的单元测试。
 *
 * 验证候选顺序与筛选规则:显式 avatar → 图片后缀的主页 url → gravatar
 * 镜像族(自配源最优先且去重)→ npm 代理;无邮箱时无 gravatar 系候选;
 * 另覆盖非法 URL 输入的容错分支(原样返回/丢弃)。
 */

import { getUserAvatarCandidates, normalizeAvatarUrl } from '../candidates'

const EMAIL = 'Dev@Example.com'

describe('getUserAvatarCandidates', () => {
    it('显式 avatar 字段排在候选链最前', () => {
        const candidates = getUserAvatarCandidates({
            name: 'a', email: EMAIL, avatar: 'https://example.com/me.png',
        } as any)
        expect(candidates[0]).toMatchObject({ url: 'https://example.com/me.png', source: 'explicit' })
    })

    it('data: URI 的显式 avatar 也接受', () => {
        const candidates = getUserAvatarCandidates({
            name: 'a', email: EMAIL, avatar: 'data:image/png;base64,xxx',
        } as any)
        expect(candidates[0]?.url).toBe('data:image/png;base64,xxx')
    })

    it('主页 url 仅当本身是图片地址才进候选', () => {
        const withImage = getUserAvatarCandidates({ name: 'a', email: EMAIL, url: 'https://a.dev/avatar.jpg' } as any)
        expect(withImage.some(item => item.source === 'url')).toBe(true)
        const withPage = getUserAvatarCandidates({ name: 'a', email: EMAIL, url: 'https://a.dev' } as any)
        expect(withPage.some(item => item.source === 'url')).toBe(false)
    })

    it('有邮箱时生成 gravatar 镜像族与 npm 代理候选,d=404 逐镜像回退', () => {
        const candidates = getUserAvatarCandidates({ name: 'a', email: EMAIL } as any)
        const gravatars = candidates.filter(item => item.source === 'gravatar')
        expect(gravatars.length).toBeGreaterThanOrEqual(4)
        for (const item of gravatars) {
            expect(item.url).toContain('/avatar/')
            expect(item.url).toContain('d=404')
            expect(item.cacheKey).toBe(gravatars[0]!.cacheKey)
        }
        expect(candidates.at(-1)?.source).toBe('npm-avatar')
        expect(candidates.at(-1)?.url).toContain('https://www.npmjs.com/npm-avatar/')
    })

    it('自配 gravatar 源最优先且与内置镜像去重', () => {
        const candidates = getUserAvatarCandidates({ name: 'a', email: EMAIL } as any, 'https://s.gravatar.com/avatar/')
        const gravatars = candidates.filter(item => item.source === 'gravatar')
        expect(gravatars.map(item => item.url)).toHaveLength(new Set(gravatars.map(item => item.url)).size)
        expect(candidates[0]?.url.startsWith('https://s.gravatar.com/avatar/')).toBe(true)
    })

    it('无邮箱时没有 gravatar/npm 候选', () => {
        const candidates = getUserAvatarCandidates({ name: 'a' } as any)
        expect(candidates).toHaveLength(0)
    })

    it('非法 avatar 字符串不是 http/data: URI,不进候选', () => {
        const candidates = getUserAvatarCandidates({
            name: 'a', email: EMAIL, avatar: 'not a url',
        } as any)
        expect(candidates.some(item => item.source === 'explicit')).toBe(false)
        expect(candidates[0]?.source).toBe('gravatar')
    })

    it('非法的主页 url 不进候选', () => {
        const candidates = getUserAvatarCandidates({ name: 'a', email: EMAIL, url: '::bad::' } as any)
        expect(candidates.some(item => item.source === 'url')).toBe(false)
    })

    it('非法的 gravatar 自配源被丢弃,不影响内置镜像', () => {
        const candidates = getUserAvatarCandidates({ name: 'a', email: EMAIL } as any, '::bad::')
        const gravatars = candidates.filter(item => item.source === 'gravatar')
        expect(gravatars.length).toBeGreaterThanOrEqual(4)
        expect(gravatars.every(item => item.url.startsWith('https://'))).toBe(true)
        // 非 http(s) 协议与根路径形态同样被归一处理
        const ftp = getUserAvatarCandidates({ name: 'a', email: EMAIL } as any, 'ftp://mirror.example/')
        expect(ftp.filter(item => item.source === 'gravatar').every(item => item.url.startsWith('https://'))).toBe(true)
        const rooted = getUserAvatarCandidates({ name: 'a', email: EMAIL } as any, 'https://mirror.example/')
        expect(rooted[0]?.url.startsWith('https://mirror.example/avatar/')).toBe(true)
    })

    it('完全空的用户对象也能安全求 fallbackKey 并返回空候选', () => {
        expect(getUserAvatarCandidates({} as any)).toEqual([])
    })

    it('normalizeAvatarUrl:协议相对地址补全,非法输入原样返回', () => {
        expect(normalizeAvatarUrl('https://EXAMPLE.com/a.png')).toBe('https://example.com/a.png')
        expect(normalizeAvatarUrl('::bad::')).toBe('::bad::')
    })
})
