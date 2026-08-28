/**
 * @file registry 元数据与拉取状态的 client 侧接收/清扫(app 域)。
 *
 * 模块职责:
 * - 监听三路服务端广播:market/registry(包的 registry 元数据增量合并进
 *  store.registry)、market/registry-status(各包元数据拉取状态)、
 *  market/registry-status/clear(整体清空);
 * - 推送微批:50ms 窗口内到达的多路推送合并成一次原地逐 key 应用,
 *  避免批量拉取期间逐包推送触发依赖页全列表连续重算(滚动掉帧源);
 * - sweepRegistryStatus:定时清扫"卡在 loading 的拉取状态"——超过两分钟
 *  没有更新的条目按超时收敛,避免依赖卡片永远转圈。
 *
 * 消费方:getRegistryStatus/getRegistryStatusText(operations.ts)、
 * 依赖页卡片与 actions.ts 的定时清扫。
 */

import { receive, store } from '@koishi-ce/client'
import type { Dict } from 'cosmokit'
import type { PluginBundleRecord, RegistryStatus } from '@koishi-ce/plugin-marketn/shared'
import type { DependencySource } from '../../src/shared/dependency-source'
import type { IgnoredUpdates } from '../shared/plugin-config'
import { translate } from '../shared/i18n'

declare module '@koishi-ce/client' {
  interface Config {
    market?: MarketConfig
  }
}

/** useConfig() 拿到的 market 段配置形态(市场索引拉取相关)。 */
interface MarketConfig {
  bulkMode?: boolean
  removeConfig?: boolean
  updateIgnoredPackages?: string
  updateIgnoreDuration?: number
  updateIgnoreVersions?: number
  updateIgnorePrerelease?: boolean
  gravatar?: string
  search?: {
    endpoint?: string
    timeout?: number
    autoRoute?: boolean
    logLevel?: string
  }
}

/** store 上由本插件注入的 registryStatus 通道的窄化声明(非官方 store 字段)。 */
export type MarketStore = typeof store & {
  registryStatus?: Dict<RegistryStatus>
}

/** registry 状态清扫周期(actions.ts 用它注册定时器)。 */
export const REGISTRY_STATUS_SWEEP_INTERVAL = 15_000
/** loading 状态超过此时长未更新即判超时。 */
const REGISTRY_STATUS_TIMEOUT = 120_000

/**
 * 清扫超时的拉取状态:仍在 loading 且 updatedAt 距今超过两分钟的条目
 * 改写成 timeout 终态(带可读错误文案)。原地逐 key 写回,避免整表
 * 替换触发依赖页全列表重渲染。返回是否有条目被改写。
 */
export function sweepRegistryStatus(target: MarketStore = store as MarketStore) {
  const now = Date.now()
  let changed = false
  for (const [name, status] of Object.entries(target.registryStatus ?? {})) {
    if (!status?.loading) continue
    if (status.updatedAt && now - status.updatedAt <= REGISTRY_STATUS_TIMEOUT) continue
    target.registryStatus[name] = {
      ...status,
      loading: false,
      reason: 'timeout',
      error: translate('common.messages.metadataTimeout'),
    }
    changed = true
  }
  return changed
}

/**
 * 推送微批缓冲:批量元数据拉取期间服务端逐包连续推送,若逐条应用,
 * 每条都会触发依赖页分类重算,滚动时叠加卡顿。短窗(50ms)内到达的
 * 多路推送合并成一次原地应用,同一包后到的状态覆盖先到的。
 */
const pendingRegistry = new Map<string, any>()
const pendingRegistryStatus = new Map<string, RegistryStatus>()
let flushTimer: ReturnType<typeof setTimeout> | undefined

function scheduleRegistryFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = undefined
    if (pendingRegistry.size) {
      if (!store.registry) store.registry = {}
      for (const [name, entry] of pendingRegistry) {
        store.registry[name] = entry
      }
      pendingRegistry.clear()
    }
    if (pendingRegistryStatus.size) {
      const target = store as MarketStore
      target.registryStatus = target.registryStatus ?? {}
      for (const [name, status] of pendingRegistryStatus) {
        target.registryStatus[name] = status
      }
      pendingRegistryStatus.clear()
    }
    sweepRegistryStatus()
  }, 50)
}

/** 丢弃未应用的微批缓冲并取消定时器(整体清空前调用)。 */
function discardPendingFlush() {
  pendingRegistry.clear()
  pendingRegistryStatus.clear()
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = undefined
  }
}

// registry 元数据增量广播:原地逐 key 合并进 store.registry(依赖卡片据此渲染版本列表)。
// 不整表替换——各卡片按包名精确订阅,逐 key 写只有被更新包的卡片重算。
receive('market/registry', (data) => {
  for (const name in data) {
    pendingRegistry.set(name, data[name])
  }
  scheduleRegistryFlush()
})

// 拉取状态广播:逐包覆盖合并,flush 时顺手清扫一次超时条目
receive('market/registry-status', (data: Dict<RegistryStatus>) => {
  for (const [name, status] of Object.entries(data)) {
    if (!status) continue
    pendingRegistryStatus.set(name, status)
  }
  scheduleRegistryFlush()
})

// 服务端要求整体清空拉取状态(例如重新开始批量拉取)
receive('market/registry-status/clear', () => {
  const target = store as MarketStore
  discardPendingFlush()
  target.registryStatus = {}
})
