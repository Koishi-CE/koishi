/**
 * @file 依赖页的分组/过滤视图 composable(dependencies 域)。
 *
 * 过滤下拉选项、各分组元信息(标题/图标/描述)、固定分组顺序、折叠记忆
 * (collapsedGroups 持久化)与"过滤 + 搜索后的分组视图"组装。
 */

import { computed, type ComputedRef, type Ref } from 'vue'
import { getCollapsedGroups, patchMarketNextData } from '../../shared/plugin-config'
import type { DependencyItem } from './use-dependency-classify'
import type { ItemKind } from './dependency-helpers'

/** 过滤下拉的选项 key(与分组 key 基本同集,含 all)。 */
export type FilterKey = 'all' | 'pending' | 'bundle' | 'unconfigured' | 'updatable' | 'ignored' | 'check-disabled' | 'invalid' | 'error' | 'local' | 'manual'

/** 展示分组:元信息 + 成员列表 + 折叠状态。 */
export interface DependencyGroup {
  key: ItemKind
  label: string
  description: string
  icon: string
  items: DependencyItem[]
  collapsed: boolean
  collapsible: boolean
}

/** 分组展示顺序(重要状态在前,普通已安装垫底)。 */
const groupOrder: ItemKind[] = ['pending', 'bundle', 'unconfigured', 'updatable', 'ignored', 'check-disabled', 'invalid', 'error', 'local', 'manual', 'installed']

/** 判定条目是否命中过滤项:pending/manual 过滤看对应标记,其余按分类,all 全收。 */
function matchesFilter(item: DependencyItem, filter: FilterKey) {
  if (filter === 'pending') return !!item.pending
  if (item.pending) return true
  if (filter === 'manual') return !!item.manual
  if (filter === 'all') return true
  return item.kind === filter
}

export function useDependencyGroups(
  items: ComputedRef<DependencyItem[]>,
  summary: ComputedRef<Record<string, number>>,
  keyword: Ref<string>,
  filter: Ref<FilterKey>,
  t: (key: string, args?: any) => string,
) {
  /** 过滤下拉选项(all + 各分类,带图标与计数)。 */
  const filterOptions = computed(() => [
    { value: 'all' as const, label: t('dependencies.filters.all'), icon: 'solid:all', count: summary.value.total },
    { value: 'pending' as const, label: t('dependencies.filters.pending'), icon: 'tag', count: summary.value.pending },
    { value: 'bundle' as const, label: t('dependencies.filters.bundle'), icon: 'file-archive', count: summary.value.bundle },
    { value: 'unconfigured' as const, label: t('dependencies.filters.unconfigured'), icon: 'preview', count: summary.value.unconfigured },
    { value: 'updatable' as const, label: t('dependencies.filters.updatable'), icon: 'asc', count: summary.value.updatable },
    { value: 'ignored' as const, label: t('dependencies.filters.ignored'), icon: 'installed', count: summary.value.ignored },
    { value: 'check-disabled' as const, label: t('dependencies.filters.checkDisabled'), icon: 'installed', count: summary.value.checkDisabled },
    { value: 'invalid' as const, label: t('dependencies.filters.invalid'), icon: 'insecure', count: summary.value.invalid },
    { value: 'error' as const, label: t('dependencies.filters.error'), icon: 'insecure', count: summary.value.errors },
    { value: 'local' as const, label: t('dependencies.filters.local'), icon: 'file-archive', count: summary.value.local },
    { value: 'manual' as const, label: t('dependencies.filters.manual'), icon: 'search', count: summary.value.manual },
  ])

  /** 各分组的元信息(标题/图标/描述,i18n)。 */
  const groupMeta = computed<Record<ItemKind, Omit<DependencyGroup, 'items' | 'collapsed' | 'collapsible'>>>(() => ({
    pending: { key: 'pending', label: t('dependencies.groups.pending.label'), icon: 'tag', description: t('dependencies.groups.pending.description') },
    bundle: { key: 'bundle', label: t('dependencies.groups.bundle.label'), icon: 'file-archive', description: t('dependencies.groups.bundle.description') },
    updatable: { key: 'updatable', label: t('dependencies.groups.updatable.label'), icon: 'asc', description: t('dependencies.groups.updatable.description') },
    ignored: { key: 'ignored', label: t('dependencies.groups.ignored.label'), icon: 'installed', description: t('dependencies.groups.ignored.description') },
    'check-disabled': { key: 'check-disabled', label: t('dependencies.groups.checkDisabled.label'), icon: 'installed', description: t('dependencies.groups.checkDisabled.description') },
    unconfigured: { key: 'unconfigured', label: t('dependencies.groups.unconfigured.label'), icon: 'preview', description: t('dependencies.groups.unconfigured.description') },
    invalid: { key: 'invalid', label: t('dependencies.groups.invalid.label'), icon: 'insecure', description: t('dependencies.groups.invalid.description') },
    error: { key: 'error', label: t('dependencies.groups.error.label'), icon: 'insecure', description: t('dependencies.groups.error.description') },
    local: { key: 'local', label: t('dependencies.groups.local.label'), icon: 'file-archive', description: t('dependencies.groups.local.description') },
    manual: { key: 'manual', label: t('dependencies.groups.manual.label'), icon: 'search', description: t('dependencies.groups.manual.description') },
    installed: { key: 'installed', label: t('dependencies.groups.installed.label'), icon: 'installed', description: t('dependencies.groups.installed.description') },
  }))

  /** 仅在"全部 + 无搜索词"时允许折叠(其他过滤视图强制展开)。 */
  const collapseEnabled = computed(() => filter.value === 'all' && !keyword.value.trim())

  /** 默认折叠的分组:未配置与忽略(信息密度低)。 */
  function getDefaultCollapsed(key: ItemKind) {
    return key === 'unconfigured' || key === 'ignored'
  }

  /** 分组折叠态:用户记忆(collapsedGroups)> 默认值。 */
  function isGroupCollapsed(key: ItemKind) {
    if (!collapseEnabled.value) return false
    return getCollapsedGroups()[key] ?? getDefaultCollapsed(key)
  }

  /** 切换分组折叠并持久化到 collapsedGroups。 */
  function toggleGroup(key: ItemKind) {
    const groups = {
      ...getCollapsedGroups(),
      [key]: !isGroupCollapsed(key),
    }
    void patchMarketNextData({ collapsedGroups: groups })
  }

  /**
   * 过滤 + 搜索后的分组视图:先按过滤项分桶(pending 过滤看 pending 标记,
   * manual 过滤看 manual 标记,其余按分类),再按关键字过滤,最后依
   * groupOrder 组装并丢弃空分组。
   */
  const visibleGroups = computed<DependencyGroup[]>(() => {
    const word = keyword.value.trim().toLowerCase()
    const buckets = Object.fromEntries(groupOrder.map(key => [key, [] as DependencyItem[]])) as Record<ItemKind, DependencyItem[]>
    for (const item of items.value) {
      if (!matchesFilter(item, filter.value)) continue
      if (word && !item.name.toLowerCase().includes(word)) continue
      buckets[item.kind].push(item)
    }
    return groupOrder
      .map(key => ({
         ...groupMeta.value[key],
        items: buckets[key],
        collapsed: isGroupCollapsed(key),
        collapsible: collapseEnabled.value,
      }))
      .filter(group => group.items.length)
  })

  return { filterOptions, groupMeta, collapseEnabled, isGroupCollapsed, toggleGroup, visibleGroups }
}
