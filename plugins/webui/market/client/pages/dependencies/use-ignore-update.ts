/**
 * @file "忽略此更新"对话框与忽略策略持久化 composable(dependencies 域)。
 *
 * 对话框支持永久禁检(包名进 updateIgnoredPackages)与按时长/次数忽略
 * (规则进数据仓 updateIgnored);确认后双写插件配置与数据仓。
 * restoreIgnoreUpdate 是独立导出的"恢复更新"动作,卡片上的恢复按钮
 * 直接调用,无需挂载整套对话框 composable。
 */

import { ref } from 'vue'
import { message } from '@koishi-ce/client'
import { createUpdateIgnoreRule, getWritableMarketNextPolicy, patchMarketNextConfig, patchMarketNextData, type UpdatePolicy } from '../../shared/plugin-config'
import type { IgnoredUpdates } from '../../shared/plugin-config'
import {
  day,
  dialogDuration,
  getDurationPreset,
  normalizeDialogCount,
  type IgnoreDurationPreset,
} from './package-utils'

/** 忽略对话框依赖的最小接口:目标包名 + 更新策略/忽略记录的读写。 */
export interface IgnoreUpdateTarget {
  name: string
  getUpdatePolicy(): UpdatePolicy
  getUpdateIgnored(): IgnoredUpdates
}

/**
 * "恢复更新"动作的独立入口:卡片上的恢复按钮直接调用,
 * 不必为这一个动作挂载整套对话框 composable。
 */
export async function restoreIgnoreUpdate(
  target: IgnoreUpdateTarget,
  config: { value: unknown },
  t: (key: string, ...args: any[]) => string,
) {
  delete target.getUpdateIgnored()[target.name]
  removePackageFromIgnoredList(target.name, config)
  const saved = await persistUpdatePolicy(target, config)
  if (!saved) message.error(t('common.messages.saveFailed'))
}

/** 忽略策略双写:全局开关进插件配置,逐包规则进数据仓。 */
async function persistUpdatePolicy(target: IgnoreUpdateTarget, config: { value: unknown }) {
  const policy = target.getUpdatePolicy()
  const configSaved = await patchMarketNextConfig({
    updateIgnoredPackages: policy.updateIgnoredPackages,
    updateIgnoreDuration: policy.updateIgnoreDuration,
    updateIgnoreVersions: policy.updateIgnoreVersions,
    updateIgnorePrerelease: policy.updateIgnorePrerelease,
  })
  const dataSaved = await patchMarketNextData({
    updateIgnored: policy.updateIgnored,
  })
  return configSaved && dataSaved
}

function addPackageToIgnoredList(name: string, config: { value: unknown }) {
  const policy = getWritableMarketNextPolicy(config.value as any)
  const names = splitIgnoredPackages(policy.updateIgnoredPackages)
  if (!names.some(item => item.toLowerCase() === name.toLowerCase())) {
    names.push(name)
  }
  policy.updateIgnoredPackages = names.join('\n')
}

function removePackageFromIgnoredList(name: string, config: { value: unknown }) {
  const policy = getWritableMarketNextPolicy(config.value as any)
  const names = splitIgnoredPackages(policy.updateIgnoredPackages)
    .filter(item => item.toLowerCase() !== name.toLowerCase())
  policy.updateIgnoredPackages = names.join('\n')
}

function splitIgnoredPackages(value?: string) {
  return (value ?? '')
    .split(/[\s,，;；]+/g)
    .map(item => item.trim())
    .filter(Boolean)
}

export function useIgnoreUpdate(
  target: IgnoreUpdateTarget,
  config: { value: unknown },
  t: (key: string, ...args: any[]) => string,
) {
  const showIgnoreDialog = ref(false)
  const ignoreDurationPreset = ref<IgnoreDurationPreset>('forever')
  const ignoreCustomDays = ref(7)
  const ignoreCount = ref(1)
  const ignorePackagePermanently = ref(false)
  const ignoreSaving = ref(false)

  function openIgnoreDialog() {
    const duration = Math.max(0, target.getUpdatePolicy().updateIgnoreDuration ?? 0)
    const days = Math.max(1, Math.ceil(duration / day))
    ignoreDurationPreset.value = duration ? getDurationPreset(duration) : 'forever'
    ignoreCustomDays.value = days
    ignoreCount.value = normalizeDialogCount(target.getUpdatePolicy().updateIgnoreVersions)
    ignorePackagePermanently.value = false
    showIgnoreDialog.value = true
  }

  async function confirmIgnoreUpdate() {
    if (ignoreSaving.value) return
    ignoreSaving.value = true
    if (ignorePackagePermanently.value) {
      addPackageToIgnoredList(target.name, config)
      delete target.getUpdateIgnored()[target.name]
      const saved = await persistUpdatePolicy(target, config)
      ignoreSaving.value = false
      if (!saved) {
        message.error(t('common.messages.saveFailed'))
        return
      }
      showIgnoreDialog.value = false
      message.success(t('dependencyCard.ignore.addedToDisabled'))
      return
    }
    const rule = createUpdateIgnoreRule(target.name, target.getUpdatePolicy(), {
      duration: dialogDuration(ignoreDurationPreset.value, ignoreCustomDays.value),
      count: ignoreCount.value,
    })
    if (!rule) {
      ignoreSaving.value = false
      return
    }
    target.getUpdateIgnored()[target.name] = rule
    const saved = await persistUpdatePolicy(target, config)
    ignoreSaving.value = false
    if (!saved) {
      message.error(t('common.messages.saveFailed'))
      return
    }
    showIgnoreDialog.value = false
    message.success(t('dependencyCard.ignore.saved'))
  }

  return {
    showIgnoreDialog, ignoreDurationPreset, ignoreCustomDays, ignoreCount,
    ignorePackagePermanently, ignoreSaving, openIgnoreDialog, confirmIgnoreUpdate,
  }
}
