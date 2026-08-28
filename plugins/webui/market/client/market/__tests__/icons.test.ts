import { describe, expect, it } from 'vitest'

/**
 * @file market 图标注册表组件(icons/index.ts)的单元测试。
 *
 * 无 DOM 环境下直接调用组件 setup 取得 render 函数,验证:注册表命中
 * (misc/outline/solid 三族)、未知/缺省名字渲染 null、透传 attrs 并
 * 注入 market-icon 类名与 1em 尺寸。
 */

type Render = () => any

/** 调 setup 拿 render 函数(组件 defineComponent 后 setup 保留在选项上)。 */
function getRender(component: any, props: Record<string, any>, attrs: Record<string, any>): Render {
    return component.setup(props, { attrs })
}

describe('MarketIcon', () => {
    it('misc/outline/solid 三族图标都注册在案', async () => {
        const { default: MarketIcon } = await import('../icons')
        for (const name of ['award', 'outline:adapter', 'solid:all']) {
            const vnode = getRender(MarketIcon, { name }, {})()
            expect(vnode, `图标 ${name} 应命中注册表`).toBeTruthy()
        }
    })

    it('未知或缺省名字渲染 null', async () => {
        const { default: MarketIcon } = await import('../icons')
        expect(getRender(MarketIcon, { name: 'nope' }, {})()).toBe(null)
        expect(getRender(MarketIcon, {}, {})()).toBe(null)
    })

    it('透传其余 attrs 并注入 market-icon 类名与 1em 尺寸', async () => {
        const { default: MarketIcon } = await import('../icons')
        const attrs = { class: 'extra', 'data-x': '1', width: '9' }
        const vnode = getRender(MarketIcon, { name: 'award' }, attrs)()
        expect(vnode.props.class).toContain('market-icon')
        expect(vnode.props.class).toContain('extra')
        expect(vnode.props['data-x']).toBe('1')
        expect(vnode.props.width).toBe('1em')
        expect(vnode.props.height).toBe('1em')
        expect(vnode.props['aria-hidden']).toBe('true')
        expect(vnode.props.focusable).toBe('false')
    })
})
