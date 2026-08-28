/**
 * @file 市场页的运行时上下文工具(market 域)。
 *
 * - useMarketI18n:市场命名空间的 i18n 组合式封装(key 自动加 market. 前缀);
 * - kConfig/MarketConfig:注入到卡片/列表组件的市场配置(是否已安装等回调);
 * - formatShortname/isPluginPackage:包名的短名展示与插件包名判定,
 *   依赖运行时市场快照(getMarketObject)。
 */

import type { SearchObject } from '@koishi-ce/registry'
import type { InjectionKey } from 'vue'
import { useMarketNextI18n } from '../shared/i18n'
import { getMarketObject } from './state'

export interface MarketConfig {
  installed?(data: SearchObject): boolean
  portable?: boolean
}

export const kConfig = Symbol('market.config') as InjectionKey<MarketConfig>

/** 包名缩短展示:市场短名 > 去官方/常规前缀 > 保留 scoped 相对形态 > 原名。 */
export function formatShortname(name: string) {
  const shortname = getMarketObject(name)?.shortname
  if (shortname && shortname !== name) return shortname
  if (name.startsWith('@koishijs/plugin-')) return name.slice('@koishijs/plugin-'.length)
  if (name.startsWith('koishi-plugin-')) return name.slice('koishi-plugin-'.length)
  const scoped = name.match(/^@([^/]+)\/koishi-plugin-(.+)$/)
  if (scoped) return `@${scoped[1]}/${scoped[2]}`
  return name
}

/** 是否 Koishi 插件包名(官方 @koishijs/plugin-* 或常规 koishi-plugin-*)。 */
export function isPluginPackage(name: string) {
  return /^@koishijs\/plugin-[0-9a-z-]+$/.test(name) || /(^|\/)koishi-plugin-[0-9a-z-]+$/.test(name)
}

export function useMarketI18n() {
  const { t: baseT, locale } = useMarketNextI18n()
  const t = (key: string, ...args: any[]) => baseT(`market.${key}`, ...args)
  return { t, locale }
}
