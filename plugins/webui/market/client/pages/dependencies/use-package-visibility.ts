/**
 * @file 依赖卡片的显隐开关 composable(dependencies 域)。
 *
 * 由状态/展示结论推导全部 show* 系列与 markIcon:控制卡片模式下
 * 各操作按钮、元数据格、版本选择器的出现条件。
 */

import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import type { PackageCardState } from './use-package-card-state'

export function usePackageVisibility(options: {
  state: PackageCardState
  t: (key: string, ...args: any[]) => string
  statusClass: ComputedRef<string>
  configText: ComputedRef<string>
  sourceText: ComputedRef<string>
  statusIcon: ComputedRef<string>
  identityIcon: ComputedRef<string>
  detailText: ComputedRef<string>
  editing: ComputedRef<boolean>
}) {
  const { state, statusClass, configText, sourceText, editing } = options
  const t = options.t

  const markIcon = computed(() => {
    if (statusClass.value === 'installed') return options.identityIcon.value
    return options.statusIcon.value
  })

  const showIdentityPill = computed(() => statusClass.value === 'installed')
  const showIdentityMeta = computed(() => statusClass.value !== 'installed')
  const showStatusBadge = computed(() => statusClass.value !== 'installed')
  const showConfigMeta = computed(() => statusClass.value !== 'installed' || configText.value !== t('dependencyCard.config.configured'))
  const showSourceMeta = computed(() => statusClass.value !== 'installed' || sourceText.value !== t('dependencyCard.source.packageJson'))

  const showTargetMeta = computed(() => {
    if (state.pending.value || state.updatable.value || state.ignoredUpdate.value) return true
    if (statusClass.value === 'manual' || statusClass.value === 'error') return true
    return !!(state.dep.value || state.local.value) && !state.localDependency.value
  })

  const showDetailText = computed(() => {
    return !!options.detailText.value && statusClass.value !== 'installed'
  })

  const showVersionControl = computed(() => {
    if (state.localDependency.value) return false
    if (!state.data.value && !state.status.value?.error) return false
    return editing.value || state.pending.value || state.updatable.value || statusClass.value === 'error' || statusClass.value === 'manual'
  })

  const showEditToggle = computed(() => {
    if (state.bundlePackage.value && (state.dep.value || state.local.value)) return !state.pending.value
    return canExpandCard.value && !state.updatable.value
  })

  // 卡片可展开性的状态排除链:逐状态否决,顺序即展示优先级
  // fallow-ignore-next-line complexity
  const canExpandCard = computed(() => {
    if (state.bundlePackage.value && (state.dep.value || state.local.value)) return !state.pending.value
    if (state.pending.value || statusClass.value === 'error' || statusClass.value === 'manual') return false
    if (state.localDependency.value) return false
    if (state.data.value) return true
    return !!state.dep.value && !state.dep.value.workspace && !state.dep.value.invalid
  })

  const showQuickUpdate = computed(() => {
    return !state.pending.value && !state.unconfigured.value && state.updatable.value && !!state.latestVersion.value && !state.localDependency.value
  })

  const showInlineIgnoreUpdate = computed(() => {
    return showQuickUpdate.value
  })

  const showRestoreUpdate = computed(() => {
    return !state.pending.value && !state.localDependency.value && state.ignoredUpdate.value
  })

  const showConfigure = computed(() => {
    return !state.pending.value && state.unconfigured.value
  })

  const showBindLocal = computed(() => {
    return !state.pending.value && state.dep.value?.source === 'unbound' && state.dep.value?.bound === false
  })

  const showRemoveDependency = computed(() => {
    return (editing.value || statusClass.value !== 'installed')
      && !state.pending.value
      && !!state.dep.value
      && !state.dep.value.workspace
      && !state.dep.value.invalid
  })

  const showCardActions = computed(() => {
    return showVersionControl.value || showQuickUpdate.value || showRestoreUpdate.value || showConfigure.value || showBindLocal.value || showRemoveDependency.value || state.pending.value
  })

  const floatingActions = computed(() => {
    return editing.value && statusClass.value === 'installed'
  })

  return {
    markIcon,
    showIdentityPill, showIdentityMeta, showStatusBadge, showConfigMeta, showSourceMeta,
    showTargetMeta, showDetailText, showVersionControl, showEditToggle, canExpandCard,
    showQuickUpdate, showInlineIgnoreUpdate, showRestoreUpdate, showConfigure,
    showBindLocal, showRemoveDependency, showCardActions, floatingActions,
  }
}
