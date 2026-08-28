/**
 * @file 安装面板的执行编排 composable(install 域)。
 *
 * installDep 是面板统一执行入口:批量模式写共享 override,非批量直接
 * install();卸载时按配置节点与用户偏好决定是否询问/移除配置,卸载后
 * 顺带清合包记录;合包目标转交 bundle-uninstall 对话框。
 */

import { ref, type Ref } from 'vue'
import { message, type Context } from '@koishi-ce/client'
import { createLocalBundleRecord, ensureInstalledConfig, getConfigWriter, install } from '../../shared/operations'
import {
  active,
  getBundleRecords,
  getPendingOverrides,
  getRemoveConfig,
  getWritableBundleRecords,
  patchMarketNextConfig,
  patchMarketNextData,
} from '../../shared/plugin-config'
import type { InstallVersions } from './use-install-versions'

export function useInstallFlow(
  versionsState: InstallVersions,
  workspace: Ref<string | undefined>,
  dep: { value: any },
  t: (key: string, args?: any) => string,
  ctx: Context,
  config: { value: any },
) {
  const { versions, bulkMode } = versionsState
  /** 卸载询问弹窗里"记住我的选择"勾选状态。 */
  const saveChoice = ref(false)
  /** "卸载时是否移除插件配置"询问弹窗开关。 */
  const showRemoveDialog = ref(false)
  /** 合包卸载对话框开关(install 面板里的卸载会转交给它)。 */
  const showBundleUninstallDialog = ref(false)
  /** 合包卸载对话框的目标包名。 */
  const bundleUninstallTarget = ref('')

  /** 关闭面板:清空 active。 */
  function closePanel() {
    active.value = ''
  }

  /** 本地包"配置插件"按钮:为其在 koishi.yml 补建配置节点后关面板。 */
  function configure() {
    getConfigWriter(ctx)?.ensure(active.value)
    closePanel()
  }

  /**
   * 面板的统一执行入口:安装指定版本 / 传空串则卸载。
   *
   * - 批量模式(workspace 包除外):只把目标写入共享 override(与现状一致时
   *   反而删除该项,支持撤销),关面板返回,由 confirm.vue 统一应用;
   * - 卸载(checkConfig)且目标在 koishi.yml 有配置节点、用户又没保存过
   *   "移除配置"偏好时,弹询问对话框,由用户选择后递归回来执行;
   * - 真正执行:把 version 记入本地 versions 映射后调 install()。成功回调里
   *   为新装包补配置节点、按选择移除配置、卸载时顺带清掉合包记录。
   */
  function installDep(version: string, checkConfig = false, removeConfig = false) {
    const target = active.value
    if (!target) return
    if (applyBulkOverride(target, version)) return
    const resolved = resolveRemoveConfig(target, checkConfig, removeConfig)
    if (resolved === 'ask') {
      showRemoveDialog.value = true
      return
    }
    persistRemoveChoice(resolved)
    versions[target] = version
    return install(versions, () => applyInstallResult(target, version, resolved))
  }

  /** 批量模式只写共享 override(与现状一致时删除该项支持撤销);返回 true 表示已处理完。 */
  function applyBulkOverride(target: string, version: string) {
    // workspace packages don't need to be installed
    if (!bulkMode.value || workspace.value) return false
    const override = getPendingOverrides()
    if (dep.value?.resolved === version || !version && !dep.value) {
      delete override[target]
    } else {
      override[target] = version
    }
    void patchMarketNextData({ override: { ...override } })
    active.value = ''
    return true
  }

  /** 卸载前解析"移除配置"偏好:有配置节点且未保存偏好时返回 'ask' 要求弹窗。 */
  function resolveRemoveConfig(target: string, checkConfig: boolean, removeConfig: boolean): boolean | 'ask' {
    // 1. The plugin is to be removed.
    // 2. The plugin has config entries.
    if (!checkConfig || !getConfigWriter(ctx)?.get(target)?.length) return removeConfig
    const saved = getRemoveConfig(config.value)
    if (typeof saved !== 'boolean') return 'ask'
    return saved
  }

  /** 按"记住我的选择"勾选持久化 removeConfig 偏好,并复位两个弹窗状态。 */
  function persistRemoveChoice(removeConfig: boolean) {
    if (saveChoice.value) {
      if (config.value.market) config.value.market.removeConfig = removeConfig
      void patchMarketNextConfig({ removeConfig })
    }
    saveChoice.value = false
    showRemoveDialog.value = false
  }

  /** install() 成功后的收尾:为新装包补配置节点、按选择移除配置、卸载顺带清合包记录。 */
  async function applyInstallResult(target: string, version: string, removeConfig: boolean) {
    if (workspace.value) return
    if (version) {
      for (const key in versions) {
        await ensureInstalledConfig(ctx, key, key !== target)
      }
    } else if (removeConfig) {
      getConfigWriter(ctx)?.remove(target)
    }
    if (!version) {
      const records = getWritableBundleRecords(config.value)
      delete records[target]
      const saved = await patchMarketNextData({ bundleRecords: records })
      if (!saved) message.warning(t('operations.confirm.saveBundleFailed'))
    }
  }

  /**
   * 卸载入口:目标是合包(有记录或本地可推导)时关掉本面板、转交
   * bundle-uninstall 对话框按成员处理;普通包走 installDep('', true)。
   */
  function requestRemove() {
    const target = active.value
    const record = target && (getBundleRecords(config.value)[target] || createLocalBundleRecord(target))
    if (target && record) {
      bundleUninstallTarget.value = target
      active.value = ''
      showBundleUninstallDialog.value = true
      return
    }
    installDep('', true)
  }

  return { saveChoice, showRemoveDialog, showBundleUninstallDialog, bundleUninstallTarget, closePanel, configure, installDep, requestRemove }
}
