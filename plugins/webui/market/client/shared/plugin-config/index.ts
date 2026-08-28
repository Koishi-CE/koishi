/**
 * @file shared/plugin-config 域聚合出口。
 *
 * 原单文件 plugin-config.ts 按职责拆为 config/data-store/update-policy/
 * silent/prefs 五个子模块,此处按拆分前的导出面原样聚合 re-export,
 * 消费方的导入路径('../shared/plugin-config')与符号名不变。
 */

export type { MarketNextConfig, MarketNextConfigPatch } from './config'
export {
  active,
  getBulkMode,
  getMarketNextConfig,
  getMarketNextPolicy,
  getRemoveConfig,
  getWritableMarketNextPolicy,
  patchMarketNextConfig,
} from './config'
export type { MarketNextDataStore } from './data-store'
export {
  getBundleRecords,
  getCollapsedGroups,
  getPendingOverrides,
  getWritableBundleRecords,
  patchMarketNextData,
} from './data-store'
export type { UpdateIgnoreOptions, UpdatePolicy } from './update-policy'
export {
  createUpdateIgnoreRule,
  getIgnoredUpdateVersion,
  getLatestVersion,
  getUpdateIgnoreText,
  hasUpdate,
  isUpdateCheckDisabled,
  isUpdateIgnored,
} from './update-policy'
export type { IgnoredUpdates, UpdateIgnoreRule } from './update-policy'
export { getMarketSilentFilters, getMarketSilentRules } from './silent'
