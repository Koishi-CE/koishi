/**
 * @file registry client 域聚合出口。
 *
 * RegistryClient 门面本体位于 registry-client.ts,路由学习状态管理
 * (recordRoute* 系列/持久化/恢复/评分)位于 route-state.ts,构造注入面
 * 位于 deps.ts,此处仅原样转发对外导出面(契约不变)。域内其余模块:
 * probe(路由探测)、route-fetch(多端点竞速)、fetch(带重试主循环)、
 * fetch-report(状态上报辅助)、endpoints(端点候选与排序纯函数)。
 */

export type { RegistryClientDeps } from "./deps.js";
export { RegistryClient } from "./registry-client.js";
export type { RegistryHttpClient } from "./route-fetch.js";
