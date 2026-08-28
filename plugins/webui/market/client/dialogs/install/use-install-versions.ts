/**
 * @file 安装面板的版本选择与 peer 兼容性分析 composable(install 域)。
 *
 * 版本初始值优先级:待应用 override > 当前依赖 request > registry 首个;
 * peer 的 registry 元数据按需增量拉取,warning/danger 的 peer 默认选
 * registry 首个版本;批量模式的覆盖清单取共享 override,非批量取本地
 * versions 映射。
 */

import { computed, reactive, watch } from 'vue'
import { send, store, useConfig } from '@koishi-ce/client'
import type { Dict } from 'cosmokit'
import { analyzeVersions, getRegistryStatus, type PeerInfo } from '../../shared/operations'
import { active, getBulkMode, getPendingOverrides, patchMarketNextConfig } from '../../shared/plugin-config'
import { isLocalDependency } from '../../../src/shared/dependency-source'

export function useInstallVersions() {
  const config = useConfig()
  /** 非批量模式的本地覆盖映射:包名 → 版本(目标包 + 需要调整的 peer)。 */
  const versions = reactive<Dict<string>>({})

  /** 批量模式开关:读取配置,写入时同步改本地配置对象并持久化。 */
  const bulkMode = computed({
    get: () => getBulkMode(config.value),
    set: (value: boolean) => {
      if (config.value.market) config.value.market.bulkMode = value
      void patchMarketNextConfig({ bulkMode: value })
    },
  })

  /** 当前目标包选中版本的读写代理(写入 versions 映射)。 */
  const version = computed({
    get: () => versions[active.value],
    set: (value) => versions[active.value] = value,
  })

  /** 头部版本下拉的双向绑定(与 version 同源)。 */
  const selectVersion = computed({
    get: () => version.value,
    set(value) {
      version.value = value
    },
  })

  /** 覆盖清单来源:批量模式取共享 override,非批量模式取本地 versions。 */
  function getOverride() {
    return bulkMode.value ? getPendingOverrides() : versions
  }

  /** 读某 peer 在覆盖清单里选定的版本。 */
  function getVersion(name: string) {
    return getOverride()[name]
  }

  /** 写 peer 版本;空串(移除)时从清单删掉该项,避免产生"卸载"语义。 */
  function setVersion(name: string, value: string) {
    const override = getOverride()
    if (value) {
      override[name] = value
    } else {
      delete override[name]
    }
  }

  /** 查询某包的 workspace 版本:依赖表与 packages 各查一遍(两处都可能记录 workspace 标记)。 */
  function getWorkspaceVersion(name: string) {
    // workspace plugins:     dependencies ? packages √
    // workspace non-plugins: dependencies √ packages ×
    if (store.dependencies?.[name]?.workspace) {
      return store.dependencies?.[name]?.resolved
    }
    if (store.packages?.[name]?.workspace) {
      return store.packages?.[name]?.package.version
    }
  }

  /** 判定某包是否本地形态:本地安装依赖、workspace 包,或不在依赖表但在 packages 里。 */
  function isLocalPackageSelection(name: string) {
    if (!name) return false
    const dependency = store.dependencies?.[name]
    return isLocalDependency(dependency)
      || !!getWorkspaceVersion(name)
      || !dependency && !!store.packages?.[name]
  }

  /** 当前选择是否"本地形态"(本地依赖/workspace/仅本地加载):面板切换为精简形态。 */
  const localSelection = computed(() => isLocalPackageSelection(active.value))

  /** peer 兼容性分析结果(analyzeVersions):各版本的 peers 明细与总体红黄绿。本地形态选择返回 undefined。 */
  const data = computed(() => {
    if (!active.value || localSelection.value) return
    return analyzeVersions(active.value, getVersion)
  })

  /** peer 行是否展示版本下拉:registry 无数据或本地包选择时不可选;已在清单中或检测不兼容(danger)时才需要手动改选。 */
  function shouldShowPeerVersionSelect(peer: PeerInfo, name: string) {
    if (!store.registry?.[name] || isLocalPackageSelection(name)) return false
    if (name in getOverride()) return true
    return peer.result === 'danger'
  }

  /** peer 实际生效版本的查找顺序:覆盖清单 > workspace > analyze 结果 > 依赖表 > 本地包。 */
  function getPeerResolvedVersion(peer: PeerInfo, name: string) {
    return getVersion(name)
      || getWorkspaceVersion(name)
      || peer.resolved
      || store.dependencies?.[name]?.resolved
      || store.packages?.[name]?.package.version
  }

  /** 是否需要拉取某包的 registry 元数据:本地无缓存、非本地形态选择、且当前没有在途请求。 */
  function shouldFetchRegistry(name: string) {
    return !store.registry?.[name]
      && !isLocalPackageSelection(name)
      && !getRegistryStatus(name)?.loading
  }

  /**
   * peer 变化时:补拉缺失的 peer registry 元数据;非批量模式下重建本地
   * versions——清掉已不在 peer 列表的选择,给 warning/danger 的 peer
   * 默认选 registry 首个版本。
   */
  // peer 元数据补拉与本地 versions 重建的成块流程,守卫链即清理规则本身
  // fallow-ignore-next-line complexity
  watch(() => data.value?.[version.value]?.peers, async (peers) => {
    if (!peers) return
    const names = Object.keys(peers).filter(shouldFetchRegistry)
    let registry: typeof store.registry = {}
    if (names.length) {
      try {
        registry = await send('market/registry', names)
      } catch (error) {
        console.error(error)
      }
    }
    Object.assign(registry, store.registry)
    if (bulkMode.value) return

    // rebuild versions
    for (const name of Object.keys(versions)) {
      if (name === active.value) continue
      if (name in peers) continue
      delete versions[name]
    }
    for (const name in peers) {
      if (!registry[name]) continue
      const { result } = peers[name]
      if (result !== 'warning' && result !== 'danger') continue
      versions[name] = Object.keys(registry[name])[0]
    }
  })

  /** 面板打开时初始化目标版本:待应用 override > 当前依赖 request > registry 首个版本;无缓存时先拉 registry 再取首个版本。 */
  // 版本初始值的优先级回退链 + 无缓存补拉,顺序即语义
  // fallow-ignore-next-line complexity
  watch(active, async (name) => {
    if (!name) return

    version.value = getPendingOverrides()[active.value]
      || store.dependencies?.[active.value]?.request
      || Object.keys(store.registry?.[name] || {})[0]

    if (shouldFetchRegistry(name)) {
      try {
        const registry = await send('market/registry', [name])
        const fetched = registry?.[active.value] || store.registry?.[active.value]
        if (fetched) version.value = Object.keys(fetched)[0]
      } catch (error) {
        console.error(error)
      }
    }
  }, { immediate: true })

  return {
    versions, bulkMode, version, selectVersion, localSelection, data,
    getOverride, getVersion, setVersion, getWorkspaceVersion,
    shouldShowPeerVersionSelect, getPeerResolvedVersion,
  }
}

export type InstallVersions = ReturnType<typeof useInstallVersions>
