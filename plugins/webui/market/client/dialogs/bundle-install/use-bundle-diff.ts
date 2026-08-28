/**
 * @file 合包安装的 diff 清单与校验结论 composable(bundle-install 域)。
 *
 * 头部统计(标题/版本/勾选进度)与底部 diff 四清单(安装/配置/移动/跳过)
 * 全部由成员勾选状态推导;清单校验复用 validateBundleManifest,
 * errors 阻断安装、warnings 仅提示。
 */

import { computed } from 'vue'
import type { PluginBundleManifest } from '../../../src/shared/bundle'
import { hasBundleKeyword, validateBundleManifest } from '../../../src/shared/bundle'
import { activeBundle } from '../../shared/operations'
import type { BundleMembers } from './use-bundle-members'

export function useBundleDiff(
  members: BundleMembers,
  t: (key: string, args?: any) => string,
) {
  /** 对话框标题:市场条目短名 > 包名 > 兜底文案。 */
  const title = computed(() => activeBundle.value?.shortname || activeBundle.value?.package.name || t('bundle.label'))
  /** 展示的合包版本:已解析的 registry 版本优先。 */
  const bundleVersion = computed(() => members.resolvedBundleVersion.value || activeBundle.value?.package.version || '')
  /** 清单校验结果(errors 阻断安装,warning 仅提示)。 */
  const validation = computed(() => {
    if (!activeBundle.value || !members.bundle.value) return { valid: false, errors: [], warnings: [] }
    return validateBundleManifest(activeBundle.value.package.name, members.bundle.value as PluginBundleManifest, {
      keyword: hasBundleKeyword(activeBundle.value.package.keywords),
    })
  })
  const validationErrors = computed(() => validation.value.errors)
  const validationWarnings = computed(() => validation.value.warnings)
  /** 勾选进度百分比(头部统计条)。 */
  const progressPercent = computed(() => members.members.length ? Math.round(members.selectedMembers.value.length / members.members.length * 100) : 0)

  /** diff"将安装"清单:合包自身@版本 + 各勾选成员@版本范围。 */
  const installList = computed(() => {
    if (!activeBundle.value) return []
    return [
      `${activeBundle.value.package.name}@${bundleVersion.value}`,
      ...members.selectedMembers.value.map(member => `${member.package}@${member.version}`),
    ]
  })
  /** diff"将配置"清单:勾选建配置且不涉及移动的成员插件键。 */
  const configList = computed(() => members.selectedMembers.value
    .filter(member => member.createConfig && !member.move)
    .map(member => member.plugin))
  /** diff"将移动"清单:勾选把组外已有配置移入分组的成员插件键。 */
  const moveList = computed(() => members.selectedMembers.value
    .filter(member => member.move)
    .map(member => member.plugin))
  /** diff"预置配置"清单:建配置且启用预置的成员插件键。 */
  const presetList = computed(() => members.selectedMembers.value
    .filter(member => member.createConfig && member.usePreset && !member.move)
    .map(member => member.plugin))
  /** diff"跳过配置"清单:既不建配置也不移动的成员插件键。 */
  const skippedConfigList = computed(() => members.selectedMembers.value
    .filter(member => !member.createConfig && !member.move)
    .map(member => member.plugin))

  return {
    title, bundleVersion, validation, validationErrors, validationWarnings, progressPercent,
    installList, configList, moveList, presetList, skippedConfigList,
  }
}

export type BundleDiff = ReturnType<typeof useBundleDiff>
