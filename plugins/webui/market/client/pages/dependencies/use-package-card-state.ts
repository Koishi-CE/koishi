/**
 * @file 依赖卡片的数据源与状态判定 composable(dependencies 域)。
 *
 * 汇聚单一卡片的所有数据入口(store 依赖/本地包/市场对象/合包记录)与
 * 状态判定族(待应用变更/更新忽略/可升级/未配置等),供展示层与显隐层消费。
 */

import { computed } from 'vue'
import { store, type Context } from '@koishi-ce/client'
import type { PluginBundleRecord } from '../../../src/shared/bundle'
import { isLocalDependency } from '../../../src/shared/dependency-source'
import {
  getBundleRecords,
  getIgnoredUpdateVersion,
  getLatestVersion,
  getMarketNextPolicy,
  getPendingOverrides,
  getWritableMarketNextPolicy,
  hasUpdate,
  isUpdateCheckDisabled,
  isUpdateIgnored,
  patchMarketNextData,
} from '../../shared/plugin-config'
import {
  analyzeVersions,
  createLocalBundleRecord,
  getConfigWriter,
  getRegistryStatus,
} from '../../shared/operations'
import { formatShortname, isPluginPackage } from '../../market/utils'
import { getMarketObject } from '../../market/state'

/** 卡片组件的 props 形态(状态层只用 name 与 kind)。 */
export interface PackageCardProps {
  name: string
  kind?: string
}

/** 反查某成员包属于哪个合包(合包记录的 members 里含有该包名)。 */
function findBundleOrigin(name: string, config: unknown): PluginBundleRecord | undefined {
  const records = getBundleRecords(config as any)
  return Object.values(records).find(record => {
    return record?.members?.some(member => member.package === name)
  })
}

export function usePackageCardState(props: PackageCardProps, config: { value: unknown }, ctx: Context) {
  const dep = computed(() => store.dependencies?.[props.name])
  const local = computed(() => store.packages?.[props.name])
  const localDependency = computed(() => {
    return isLocalDependency(dep.value)
      || props.kind === 'local' && !dep.value && !!local.value
  })
  const marketData = computed(() => getMarketObject(props.name))
  const bundleRecord = computed(() => getBundleRecords(config.value as any)[props.name] || createLocalBundleRecord(props.name))
  const bundleOrigin = computed(() => findBundleOrigin(props.name, config.value))
  const displayName = computed(() => formatShortname(props.name))
  const data = computed(() => {
    if (localDependency.value || dep.value?.invalid) return
    return analyzeVersions(props.name, (name) => getPendingOverrides()[name])
  })
  const status = computed(() => getRegistryStatus(props.name))

  function getUpdatePolicy() {
    return getMarketNextPolicy(config.value as any)
  }

  function getUpdateIgnored() {
    const policy = getWritableMarketNextPolicy(config.value as any)
    policy.updateIgnored ||= {}
    return policy.updateIgnored
  }

  const latestVersion = computed(() => {
    const latest = getLatestVersion(props.name, getUpdatePolicy())
    if (latest) return latest
    const ignored = getIgnoredUpdateVersion(props.name, getUpdatePolicy())
    if (ignored) return ignored
    return dep.value?.latest ?? local.value?.package.version
  })

  const overrideValue = computed(() => {
    const override = getPendingOverrides()
    if (!Object.prototype.hasOwnProperty.call(override, props.name)) return
    return override[props.name]
  })

  const pending = computed(() => overrideValue.value !== undefined)
  const pendingRemove = computed(() => pending.value && !overrideValue.value)
  const updateCheckDisabled = computed(() => isUpdateCheckDisabled(props.name, getUpdatePolicy()))
  const ignoredUpdate = computed(() => updateCheckDisabled.value || isUpdateIgnored(props.name, getUpdatePolicy()))
  const updatable = computed(() => !!hasUpdate(props.name, getUpdatePolicy()))
  const bundlePackage = computed(() => !!bundleRecord.value)
  const unconfigured = computed(() => {
    if (bundlePackage.value) return false
    const configWriter = getConfigWriter(ctx)
    return !!configWriter && !!local.value && isPluginPackage(props.name) && !configWriter.get(props.name)?.length
  })

  function setOverride(next: Record<string, string>) {
    void patchMarketNextData({ override: { ...next } })
  }

  return {
    name: props.name,
    kind: props.kind,
    dep, local, localDependency, marketData, bundleRecord, bundleOrigin, displayName, data, status,
    getUpdatePolicy, getUpdateIgnored,
    latestVersion, overrideValue, pending, pendingRemove, updateCheckDisabled, ignoredUpdate,
    updatable, bundlePackage, unconfigured, setOverride,
  }
}

export type PackageCardState = ReturnType<typeof usePackageCardState>
