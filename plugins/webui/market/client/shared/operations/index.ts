/**
 * @file shared/operations 域聚合出口。
 *
 * 原单文件 operations.ts 按职责拆为 state/analyze/bundle/progress/install/ensure
 * 六个子模块,此处按拆分前的导出面原样聚合 re-export,消费方的导入路径
 * ('../shared/operations')与符号名不变。
 */

export { install, applyEnvironmentSnapshot } from './install'
export {
  prepareInstallFallbackRetry,
  resetInstallFallbackState,
  installProgressState,
} from './progress'
export type { LogLine, InstallOptions } from './progress'
export { ensureInstalledConfig, ensureInstalledConfigs } from './ensure'
export { analyzeVersions, getRegistryStatus, getRegistryStatusText } from './analyze'
export type { PeerInfo, ResultType } from './analyze'
export {
  createLocalBundleRecord,
  fetchBundleRecord,
  getBundleMemberConfigState,
  resolveBundlePackageFromGroup,
  resolveBundleRecordFromGroup,
} from './bundle'
export type { BundleRecordView } from './bundle'
export {
  activeBundle,
  addManual,
  expandedDependency,
  getConfigWriter,
  MARKET_NEXT_PACKAGE,
  pendingBundleUninstalls,
  showConfirm,
  showEnvironmentVersions,
  showInstallHistory,
  showManual,
} from './state'
export type { BundleMemberCleanupTarget, ClientConfigWriter } from './state'
