/**
 * @file 合包分组卸载请求的轻量状态模块(extensions 域)。
 *
 * 配置树右键"卸载合包"时,把目标分组节点暂存到 bundleGroupUninstallTarget,
 * 由 bundle-group-uninstall/index.vue watch 该 ref 弹出对话框。index.ts 的
 * patchConfigRemoveAction 是唯一调用方。
 */
import { ref } from 'vue'
import type { ConfigTreeNode } from '../config-remove/index'

/** 待卸载的合包分组节点;undefined 表示对话框关闭。 */
export const bundleGroupUninstallTarget = ref<ConfigTreeNode>()

/** 请求卸载合包分组:传入目标节点(空值忽略,供菜单回调直接透传)。 */
export function requestBundleGroupUninstall(target?: ConfigTreeNode) {
  if (!target) return
  bundleGroupUninstallTarget.value = target
}
