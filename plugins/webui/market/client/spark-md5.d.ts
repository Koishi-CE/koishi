// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * spark-md5 的最小类型声明。
 *
 * 上游包不带类型且仓库未引入 @types/spark-md5，本文件仅声明
 * 本插件 client 实际用到的 hash 接口（gravatar 邮箱摘要），
 * 作为 market/client 类型程序内的环境声明（ambient）存在。
 */
declare module "spark-md5" {
	export function hash(str: string): string;
}
