import { describe, expect, it } from 'vitest'

/**
 * @file 市场条目作者/维护者归一与缓存的单元测试。
 *
 * 覆盖:getUserKey 的三级回落、contributors 去重与空 key 跳过、
 * maintainers 与 contributors 的交集判定(有交集展示 contributors,
 * 无交集展示 maintainers 且 name 回落 username)与 WeakMap 缓存命中。
 */

import { getUserKey, getUsers } from '../users'
import { makeEntry } from './helpers'

const mail = (email: string, name = email) => ({ name, email }) as any

describe('getUserKey', () => {
    it('email 优先,其次 username,最后 name,都缺为假值', () => {
        expect(getUserKey(mail('a@x'))).toBe('a@x')
        expect(getUserKey({ username: 'u' } as any)).toBe('u')
        expect(getUserKey({ name: 'n' } as any)).toBe('n')
        expect(getUserKey({} as any)).toBeFalsy()
    })
})

describe('getUsers', () => {
    it('同一条目复用缓存结果', () => {
        const data = makeEntry({
            package: {
                name: 'koishi-plugin-foo',
                contributors: [mail('a@x')],
                maintainers: [mail('a@x')],
            },
        })
        expect(getUsers(data)).toBe(getUsers(data))
    })

    it('contributors 按去重标识去重,同人多次贡献只留第一个', () => {
        const first = { name: '第一', email: 'a@x' } as any
        const second = { name: '第二', email: 'a@x' } as any
        const data = makeEntry({
            package: {
                name: 'koishi-plugin-foo',
                contributors: [first, second, mail('b@x')],
                maintainers: [mail('a@x', '维护者')],
            },
        })
        expect(getUsers(data)).toEqual([first, mail('b@x')])
    })

    it('无去重标识(email/username/name 全缺)的 contributor 被跳过', () => {
        const data = makeEntry({
            package: {
                name: 'koishi-plugin-foo',
                contributors: [{} as any, mail('a@x')],
                maintainers: [mail('a@x')],
            },
        })
        expect(getUsers(data)).toEqual([mail('a@x')])
    })

    it('maintainers 为空列表时展示用户列表也为空(不回落 contributors)', () => {
        const data = makeEntry({
            package: { name: 'koishi-plugin-foo', contributors: [mail('a@x')], maintainers: [] },
        })
        expect(getUsers(data)).toEqual([])
    })

    it('maintainer 出现在 contributors 中时展示去重后的 contributors', () => {
        const data = makeEntry({
            package: {
                name: 'koishi-plugin-foo',
                contributors: [mail('a@x'), mail('b@x')],
                maintainers: [mail('a@x', '维护者')],
            },
        })
        const users = getUsers(data)
        expect(users).toEqual([mail('a@x'), mail('b@x')])
    })

    it('maintainer 不在 contributors 中时展示 maintainers,name 缺省回落 username', () => {
        const data = makeEntry({
            package: {
                name: 'koishi-plugin-foo',
                contributors: [mail('a@x')],
                maintainers: [{ username: 'm1' } as any, { name: 'm2', username: 'm2u' } as any],
            },
        })
        expect(getUsers(data)).toEqual([
            { username: 'm1', name: 'm1' },
            { name: 'm2', username: 'm2u' },
        ])
    })

    it('maintainer 用 username/其他字段与 contributors 的 key 相同也算交集', () => {
        const data = makeEntry({
            package: {
                name: 'koishi-plugin-foo',
                contributors: [{ username: 'shared' } as any],
                maintainers: [{ username: 'shared' } as any],
            },
        })
        expect(getUsers(data)).toEqual([{ username: 'shared' } as any])
    })

    it('contributors 缺省按空列表处理', () => {
        const data = makeEntry({
            package: { name: 'koishi-plugin-foo', maintainers: [mail('a@x')] },
        })
        expect(getUsers(data)).toEqual([mail('a@x')])
    })
})
