/**
 * @file peerDependencies 兼容性扫描与 registry 拉取状态(shared/operations 域)。
 *
 * - analyzeVersions:逐版本扫描包的 peerDependencies,驱动依赖卡片的红/黄/绿
 *   状态;数据源优先运行中插件的真实 registry,缺则用手动添加缓存。
 * - getRegistryStatus(Text):读取并翻译 registry 拉取状态(loading/超时/404 等)。
 */

import { valueMap } from 'cosmokit'
import type { Dict } from 'cosmokit'
import { store } from '@koishi-ce/client'
import type { RegistryStatus } from '@koishi-ce/plugin-marketn/shared'
import { satisfies } from 'semver'
import { translate } from '../i18n'
import { endpointHost } from '../format'
import { manualDeps } from './state'

/** 依赖/peer 检查结论的展示级别:success 绿 / warning 黄 / danger 红 / primary 蓝(仅提示)。 */
export type ResultType = 'success' | 'warning' | 'danger' | 'primary'

/** 单个 peer 依赖的检查结果:request 为期望范围,resolved 为宿主实际版本。 */
export interface PeerInfo {
  request: string
  resolved: string
  result: ResultType
}

interface AnalyzeResult {
  peers: Dict<PeerInfo>
  result: ResultType
}

/**
 * 逐版本扫描某个包的 peerDependencies 兼容性。
 *
 * 数据源优先级:运行中插件的真实 registry(store.registry,含未发布版本)>
 * 手动添加的 manualDeps。每个 peer 的已装版本依次尝试 getVersion 回调、
 * store.dependencies、store.packages 三处;optional peer 缺失时只标 primary
 * (蓝,提示而非报错)。任一 peer danger 则整版本 danger,deprecated 版本直接 danger。
 *
 * @param name 包名
 * @param getVersion 自定义版本查询(依赖页传入以覆盖默认查找顺序)
 */
export function analyzeVersions(name: string, getVersion: (name: string) => string): Dict<AnalyzeResult> {
  const versions = store.registry?.[name] || manualDeps[name]?.versions
  if (!versions) return
  return valueMap(versions, (item) => {
    const peers = valueMap({ ...item.peerDependencies }, (request, name) => {
      const resolved = (getVersion ? getVersion(name) : null)
        ?? store.dependencies[name]?.resolved
        ?? store.packages?.[name]?.package.version
      const result: ResultType = !resolved
        ? item.peerDependenciesMeta?.[name]?.optional ? 'primary' : 'danger'
        : satisfies(resolved, request, { includePrerelease: true }) ? 'success' : 'danger'
      return { request, resolved, result } as PeerInfo
    })
    let result: 'success' | 'warning' | 'danger' = 'success'
    for (const peer of Object.values(peers)) {
      if (peer.result === 'danger') {
        result = 'danger'
        break
      }
      if (peer.result === 'warning') {
        result = 'warning'
      }
    }
    if (item.deprecated) result = 'danger'
    return { peers, result }
  })
}

/** store 上由本插件注入的运行时 registry 状态通道(非官方 store 字段的窄化声明)。 */
type MarketStore = typeof store & {
  registryStatus?: Dict<RegistryStatus>
}

/** 读取某包的 registry 拉取状态(loading/失败原因/重试次数),供依赖卡片展示。 */
export function getRegistryStatus(name: string) {
  return (store as MarketStore).registryStatus?.[name]
}

/** 把 registry 状态翻译成用户可读文案:进行中/超时/404/网络错误等各占一条 i18n。 */
export function getRegistryStatusText(name: string) {
  const status = getRegistryStatus(name)
  if (!status || status.loading) {
    return translate('dependencyCard.registry.loading', {
      endpoint: status?.endpoint ? ` (${endpointHost(status.endpoint)})` : '',
      attempts: status?.attempts ? `, ${translate('dependencyCard.registry.attempts', { count: status.attempts })}` : '',
    })
  }
  const endpoint = status.endpoint ? ` (${endpointHost(status.endpoint)})` : ''
  switch (status.reason) {
    case 'timeout':
      return translate('dependencyCard.registry.timeout', { endpoint })
    case 'not-found':
      return translate('dependencyCard.registry.notFound', { endpoint })
    case 'network':
      return translate('dependencyCard.registry.network', { endpoint })
    case 'invalid':
      return translate('dependencyCard.registry.invalid', { endpoint })
    case 'http':
      return translate('dependencyCard.registry.http', { endpoint })
    default:
      return translate('dependencyCard.registry.unknown', { endpoint, error: status.error ? `: ${status.error}` : '' })
  }
}
