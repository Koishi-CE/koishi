/**
 * @file 插件配置节点移除请求的轻量状态模块(extensions 域)。
 *
 * 配置树右键"移除配置/移除分组"时,把目标节点暂存到 configRemoveTarget,
 * 由 config-remove/index.vue watch 该 ref 弹出确认对话框。index.ts 的
 * patchConfigRemoveAction 是 requestConfigRemove 的调用方;
 * isProtectedConfigNode 同时用于禁用宿主核心插件节点的移除入口。
 */
import { ref } from 'vue'

/** @koishi-ce/plugin-config 配置树节点的最小结构声明(扩展点回调拿到的 tree 形态)。 */
export interface ConfigTreeNode {
  id: string
  name: string
  path: string
  label?: string
  children?: ConfigTreeNode[]
  parent?: ConfigTreeNode
}

/** 宿主运行所必需的核心插件,其配置节点(含分组内的子节点)受保护不可移除。 */
const coreDeps = ['@koishijs/plugin-console', '@koishi-ce/plugin-config', '@koishijs/plugin-server']

/** 待移除的配置节点;undefined 表示对话框关闭。 */
export const configRemoveTarget = ref<ConfigTreeNode>()

/** 请求移除配置节点:传入目标节点(空值忽略,供菜单回调直接透传)。 */
export function requestConfigRemove(target?: ConfigTreeNode) {
  if (!target) return
  configRemoveTarget.value = target
}

/** 判定节点是否受保护:节点(或其子孙)命中核心插件名即不可移除。 */
export function isProtectedConfigNode(target?: ConfigTreeNode): boolean {
  if (!target) return false
  if (coreDeps.includes('@koishijs/plugin-' + target.name)) return true
  return target.children?.some(isProtectedConfigNode) ?? false
}

