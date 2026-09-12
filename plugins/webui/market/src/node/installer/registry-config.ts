// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 本机 npm registry 配置探测（零子进程）。
 *
 * 实现已收敛到 @koishi-ce/utils 的 npm-registry 模块（与 create-koishi-ce
 * 的 registry.ts 共享同一实现），此处按原公共 API 再导出；官方源回落由
 * installer 在调用处以 NPM_OFFICIAL_REGISTRY 兜底，保证 http 恒有
 * endpoint 可拼接相对 URL——缺省时相对请求会在 resolveURL 抛 Invalid URL。
 */
export {
	getLocalRegistry,
	NPM_OFFICIAL_REGISTRY,
} from "@koishi-ce/utils";
