// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import type { Store } from "@koishi-ce/client";

// node 侧 logs 服务声明的负载数组（经 Store 结构化推导取回真实记录形态）
type RealRecord = NonNullable<Store["logs"]>[number];

/**
 * 前端消费的日志记录形态：
 * - node 侧运行时在 meta 上写入 paths（来源插件），reggol 的 Meta
 *   类型未声明——按运行时事实扩展
 * - 开放索引签名：virtual-list 的 data prop 为 Record<string, unknown>[]，
 *   接口缺索引签名就无法作为其数据源
 */
export interface LogRecord extends RealRecord {
	meta: RealRecord["meta"] & { paths?: string[] };
	[key: string]: unknown;
}
