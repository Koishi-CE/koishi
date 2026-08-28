/**
 * @file 市场静默过滤(silent filters)配置的读取与规则转换(shared/plugin-config 域)。
 *
 * 静音过滤有三代配置形态(marketSilentFilters 字符串 → 四组结构化规则 →
 * marketSilentRules 扁平规则),读取时按"最新形态优先"逐级回退,最终都
 * 归一成查询词数组(is:xxx / created:<2020-01-01 / created:within:30 等)。
 */

import type {
  MarketSilentCustomRule,
  MarketSilentDateRule,
  MarketSilentRecentRule,
  MarketSilentRule,
  MarketSilentStatusRule,
} from '../../../src/shared/types'
import { getMarketNextConfig, hasOwn } from './config'

interface SilentConfig {
  market?: {
    marketSilentStatusRules?: MarketSilentStatusRule[]
    marketSilentDateRules?: MarketSilentDateRule[]
    marketSilentRecentRules?: MarketSilentRecentRule[]
    marketSilentCustomRules?: MarketSilentCustomRule[]
    marketSilentRules?: MarketSilentRule[]
    marketSilentFilters?: string
  }
}

/**
 * 把静音过滤配置转成多行查询词字符串(每行一条,供搜索框回显)。
 * 优先级:扁平规则 marketSilentRules > 四组结构化规则 > 原始字符串
 * marketSilentFilters;三者都没配置时返回空串。
 */
export function getMarketSilentFilters(config?: SilentConfig) {
  const pluginConfig = getMarketNextConfig()
  if (hasOwn(pluginConfig, 'marketSilentRules')) {
    return rulesToSilentFilters(Array.isArray(pluginConfig.marketSilentRules) ? pluginConfig.marketSilentRules : []).join('\n')
  }
  if (hasNewSilentRuleConfig(pluginConfig)) {
    return structuredSilentRulesToFilters(pluginConfig).join('\n')
  }
  if (hasOwn(pluginConfig, 'marketSilentFilters')) {
    return String(pluginConfig.marketSilentFilters ?? '')
  }
  return ''
}

/**
 * 把静音过滤配置转成查询词数组(市场页据此做 getSilentFiltered 预过滤)。
 * 优先级同 getMarketSilentFilters。
 */
export function getMarketSilentRules(config?: SilentConfig) {
  const pluginConfig = getMarketNextConfig()
  if (hasOwn(pluginConfig, 'marketSilentRules')) return rulesToSilentFilters(Array.isArray(pluginConfig.marketSilentRules) ? pluginConfig.marketSilentRules : [])
  if (hasNewSilentRuleConfig(pluginConfig)) return structuredSilentRulesToFilters(pluginConfig)
  return []
}

/** 四组结构化静音规则里任意一组有内容即视为"新形态配置已启用"。 */
function hasNewSilentRuleConfig(config?: Record<string, any>) {
  return hasConfiguredSilentRules(config?.marketSilentStatusRules)
    || hasConfiguredSilentRules(config?.marketSilentDateRules)
    || hasConfiguredSilentRules(config?.marketSilentRecentRules)
    || hasConfiguredSilentRules(config?.marketSilentCustomRules)
}

/** 非空数组才算"已配置"(undefined/空数组都视为未配置)。 */
function hasConfiguredSilentRules(value: unknown) {
  return Array.isArray(value) && value.length > 0
}

/** 四组结构化规则全部转平并合并成查询词数组。 */
function structuredSilentRulesToFilters(config?: SilentConfig['market']) {
  return [
    ...statusRulesToFilters(config?.marketSilentStatusRules ?? []),
    ...dateRulesToFilters(config?.marketSilentDateRules ?? []),
    ...recentRulesToFilters(config?.marketSilentRecentRules ?? []),
    ...customRulesToFilters(config?.marketSilentCustomRules ?? []),
  ]
}

/** 状态规则 → `is:xxx` 查询词(enabled=false 或缺 target 的丢弃)。 */
function statusRulesToFilters(rules: MarketSilentStatusRule[]) {
  return rules
    .filter(rule => rule?.enabled !== false && rule.target)
    .map(rule => `is:${rule.target}`)
}

/** 日期规则 → `created:<2020-01-01` 形态(日期格式不合法的丢弃)。 */
function dateRulesToFilters(rules: MarketSilentDateRule[]) {
  return rules
    .filter(rule => rule?.enabled !== false && rule.field && rule.relation && isDateString(rule.date))
    .map((rule) => `${rule.field}:${rule.relation === 'before' ? '<' : '>'}${rule.date}`)
}

/** 近期规则 → `created:within:30` 形态(days 必须为正数)。 */
function recentRulesToFilters(rules: MarketSilentRecentRule[]) {
  return rules
    .filter(rule => rule?.enabled !== false && rule.field && Number.isFinite(rule.days) && rule.days! > 0)
    .map(rule => `${rule.field}:within:${Math.floor(rule.days!)}`)
}

/** 自定义规则 → 原样输出查询词(去空白)。 */
function customRulesToFilters(rules: MarketSilentCustomRule[]) {
  return rules
    .filter(rule => rule?.enabled !== false)
    .map(rule => String(rule.query ?? '').trim())
    .filter(Boolean)
}

/** 严格校验 YYYY-MM-DD 字符串。 */
function isDateString(value?: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '')
}

/** 扁平规则数组 → 有效查询词数组(enabled=false 与转换失败的丢弃)。 */
function rulesToSilentFilters(rules: MarketSilentRule[]) {
  return rules
    .filter(rule => rule?.enabled !== false)
    .map(rule => ruleToSilentFilter(rule))
    .filter(Boolean)
}

/**
 * 单条扁平规则 → 查询词。value 字段按规则类型被复用为 date/days/query
 * 的兜底来源;无法转换(日期非法、天数非正整数等)返回空串由上层过滤。
 */
function ruleToSilentFilter(rule: MarketSilentRule) {
  const value = String(rule.value ?? '').trim()
  const date = String(rule.date ?? value).trim()
  const days = rule.days == null ? value : String(rule.days)
  const query = String(rule.query ?? value).trim()
  switch (rule.type) {
    case 'preview': return 'is:preview'
    case 'insecure': return 'is:insecure'
    case 'bundle': return 'is:bundle'
    case 'created-before': return isDateString(date) ? `created:<${date}` : ''
    case 'created-after': return isDateString(date) ? `created:>${date}` : ''
    case 'updated-before': return isDateString(date) ? `updated:<${date}` : ''
    case 'updated-after': return isDateString(date) ? `updated:>${date}` : ''
    case 'created-within': return isPositiveInteger(days) ? `created:within:${Math.floor(Number(days))}` : ''
    case 'updated-within': return isPositiveInteger(days) ? `updated:within:${Math.floor(Number(days))}` : ''
    case 'custom':
    default:
      return query
  }
}

/** 字符串形式的无符号正整数判定(within:N 类规则的入参校验)。 */
function isPositiveInteger(value?: string) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 && Math.floor(number) === number
}
