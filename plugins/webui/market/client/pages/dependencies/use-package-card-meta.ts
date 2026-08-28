/**
 * @file 依赖卡片的元数据文案 composable(dependencies 域)。
 *
 * 配置/来源/身份族文案与卡片配色:identity 由包名与市场分类推断,
 * 已装态卡片用 identity 色做强调色(cardStyle),其余态在元数据区展示。
 */

import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import { useI18nText } from '@koishi-ce/client'
import type { Context as ClientContext } from '@koishi-ce/client'
import { getConfigWriter } from '../../shared/operations'
import { formatShortname, isPluginPackage } from '../../market/utils'
import { resolveIdentity } from './package-utils'
import type { PackageCardState } from './use-package-card-state'

export function usePackageCardMeta(
  state: PackageCardState,
  t: (key: string, ...args: any[]) => string,
  editing: ComputedRef<boolean>,
  ctx: ClientContext,
  statusClass: ComputedRef<string>,
) {
  const tt = useI18nText()
  const configText = computed(() => {
    if (state.bundlePackage.value) return t('dependencyCard.config.notNeeded')
    if (!isPluginPackage(state.name)) return t('dependencyCard.config.notPlugin')
    if (!getConfigWriter(ctx)) return t('dependencyCard.config.unknown')
    if (!state.local.value) return state.pending.value ? t('dependencyCard.config.pending') : t('dependencyCard.config.notLoaded')
    return state.unconfigured.value ? t('dependencyCard.config.unconfigured') : t('dependencyCard.config.configured')
  })

  // 来源文案的优先级映射:bundle/合包自引用/市场源/工作区/本地等来源互斥判定链,顺序即语义
  // fallow-ignore-next-line complexity
  const sourceText = computed(() => {
    if (state.bundleOrigin.value) return t('dependencyCard.source.bundle', { name: state.bundleOrigin.value.label || formatShortname(state.bundleOrigin.value.package) })
    if (state.bundleRecord.value) return t('dependencyCard.source.bundleSelf')
    if (state.dep.value?.source) return t(`dependencyCard.source.${state.dep.value.source}`)
    if (state.localDependency.value) return state.local.value?.workspace
      ? t('dependencyCard.source.workspace')
      : t('dependencyCard.source.local')
    if (state.dep.value?.workspace || state.local.value?.workspace) return t('dependencyCard.source.workspace')
    if (state.pending.value && !state.dep.value) return t('dependencyCard.source.pending')
    if (!state.dep.value && state.local.value) return t('dependencyCard.source.local')
    if (!state.dep.value) return t('dependencyCard.source.manual')
    return t('dependencyCard.source.packageJson')
  })

  const removeButtonText = computed(() => state.bundleRecord.value ? t('dependencyCard.actions.uninstallBundle') : t('dependencyCard.actions.uninstall'))

  const requestText = computed(() => {
    if (!state.dep.value?.request) return ''
    if (state.dep.value.request === state.dep.value.resolved) return ''
    return state.dep.value.request
  })

  const identity = computed(() => resolveIdentity(state.name))
  const identityText = computed(() => t(identity.value.label))
  const identityIcon = computed(() => identity.value.icon)

  const cardStyle = computed(() => {
    if (statusClass.value !== 'installed') return {}
    return {
      '--dep-accent': identity.value.color,
    }
  })

  const summaryText = computed(() => {
    // package.description 不在官方 PackageJson 窄化类型里,市场数据/本地包均可能带
    const localDescription = (state.local.value?.package as { description?: unknown })?.description
    return tt(state.marketData.value?.manifest?.description)
      || tt(state.marketData.value?.package?.description)
      || tt(localDescription as string | Record<string, string> | undefined)
  })

  const editToggleText = computed(() => {
    if (state.bundlePackage.value) return t('dependencyCard.actions.manage')
    if (editing.value) return t('dependencyCard.actions.collapse')
    return state.data.value ? t('dependencyCard.actions.edit') : t('dependencyCard.actions.operate')
  })

  return {
    configText, sourceText, removeButtonText, requestText,
    identity, identityText, identityIcon, cardStyle, summaryText, editToggleText,
  }
}
