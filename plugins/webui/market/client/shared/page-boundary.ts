/**
 * @file 页面级错误边界工厂(shared 域,被 app/pages.ts 消费)。
 *
 * 模块职责:用 onErrorCaptured 包住市场/依赖两个重页面组件——渲染期抛出的
 * 任何异常都拦截在这里,渲染兜底的 k-empty + "重试"按钮,而不是让异常
 * 冒泡到 console 根组件导致整个控制台白屏。
 *
 * 关键设计:重试通过 revision 自增并作为内层组件的 key,强制 Vue 销毁
 * 旧实例、从零重新挂载,清掉出错组件内部的残留状态。
 */

import { type Component, defineComponent, h, onErrorCaptured, ref, resolveComponent, shallowRef } from 'vue'
import { translate } from './i18n'

/**
 * 为页面组件包一层错误边界。
 *
 * @param page 页面标识(仅用于组件名与错误日志前缀)
 * @param component 实际的页面组件
 */
export function createPageBoundary(page: string, component: Component) {
  return defineComponent({
    name: `MarketNext${page}Boundary`,
    setup() {
      /** 捕获到的渲染异常;有值时渲染兜底 UI。 */
      const error = shallowRef<unknown>()
      /** 重试计数:自增后作为内层组件 key,触发整体重新挂载。 */
      const revision = ref(0)
      const Empty = resolveComponent('k-empty')
      const Button = resolveComponent('el-button')

      // 拦截内层组件树的所有异常并返回 false 阻止继续向上冒泡
      onErrorCaptured((reason, _instance, info) => {
        error.value = reason
        console.error(`[market-next] ${page} page render failed (${info})`, reason)
        return false
      })

      /** 用户点击"重试":清错误、bump revision 重新挂载页面组件。 */
      const retry = () => {
        error.value = undefined
        revision.value++
      }

      return () => error.value
        ? h('div', { class: 'market-page-error' }, [
          h(Empty, null, {
            default: () => translate('common.messages.pageRenderFailed'),
          }),
          h(Button, { type: 'primary', onClick: retry }, {
            default: () => translate('common.actions.retry'),
          }),
        ])
        : h(component, { key: revision.value })
    },
  })
}
