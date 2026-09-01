// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

// which-pm-runs 没有官方类型声明，npm 上也不存在 @types/which-pm-runs。
// 以下按其 1.1.0 源码（index.js）手写形状：
// 未检测到 npm_config_user_agent 环境变量时返回 undefined，
// 否则返回包管理器的名称（npminstall 会归一化为 cnpm）与版本。
declare module "which-pm-runs" {
	export interface PackageManager {
		name: string;
		version: string;
	}

	export function whichPMRuns(): PackageManager | undefined;
}
