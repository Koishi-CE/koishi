/**
 * @file market/avatar 域聚合出口。
 *
 * 原单文件 avatar.ts 按职责拆为 candidates(候选链纯函数)/cache(双缓存
 * 与 TTL)/fetch(RPC 抓取)三个子模块,此处按拆分前的导出面原样聚合
 * re-export,utils.ts 的 `export * from './avatar'` 与消费方符号不变。
 */

export type { AvatarCandidate } from './candidates'
export { getUserAvatarCandidates } from './candidates'
export { getCachedAvatarFromCandidates } from './cache'
export { cacheAvatarFailure, isAvatarFailureCached } from './cache'
export { fetchAndCacheAvatar, fetchCachedAvatar } from './fetch'
