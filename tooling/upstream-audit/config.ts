// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 上游巡检配置：缓存位置与巡检清单装载。
 *
 * 巡检清单数据本体在同目录 upstreams.json（纯数据），与
 * docs/process/upstream.md 的 Restructure map 一一对应。
 * URL 一律写当前有效地址（仓库改名后旧地址虽会重定向，落盘以新名为准）。
 */
import { resolve } from "node:path";

/** 仓库根目录（本工具位于 tooling/upstream-audit/ 下）。 */
export const ROOT = resolve(import.meta.dirname, "../..");

/** 上游缓存目录：默认开发目录下的 cache/upstream（仓库同级），绝不落在仓库内部。 */
export const CACHE =
	Bun.env["KOISHI_CE_UPSTREAM_CACHE"] ??
	resolve(ROOT, "..", "cache", "upstream");

/** 单条目录映射：上游子路径 → 本仓目录。up 为 "." 表示仓库根。 */
export interface Mapping {
	up: string;
	ours: string;
	/** glob 映射（如 plugins/* → plugins/webui/*）：按上游子目录展开。 */
	glob?: boolean;
	/** 跳过内容对比（vendored 预编译产物等），只在底稿里记录存在。 */
	skipDiff?: boolean;
	note?: string | undefined;
}

/** 单个上游仓库：克隆地址 + 基线注记 + 映射清单。 */
export interface Upstream {
	name: string;
	url: string;
	baseline: string;
	mappings: Mapping[];
}

const DATA: unknown = await Bun.file(
	resolve(import.meta.dirname, "upstreams.json"),
).json();

export const UPSTREAMS = DATA as Upstream[];
