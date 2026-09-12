// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 上游巡检配置：缓存位置与巡检清单。
 *
 * 巡检清单与 docs/process/upstream.md 的 Restructure map 一一对应。
 * URL 一律写当前有效地址（仓库改名后旧地址虽会重定向，落盘以新名为准）。
 */
import { resolve } from "node:path";

/** 仓库根目录（本工具位于 tooling/upstream-audit/ 下）。 */
export const ROOT = resolve(import.meta.dirname, "../..");

/** 上游缓存目录：默认仓库同级，绝不落在仓库内部。 */
export const CACHE =
	process.env["KOISHI_CE_UPSTREAM_CACHE"] ??
	resolve(ROOT, "..", "upstream-cache");

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

export const UPSTREAMS: Upstream[] = [
	{
		name: "koishi",
		url: "https://github.com/koishijs/koishi.git",
		baseline:
			"koishi@4.18.11 线（master 领先量很小，见底稿 HEAD 行）",
		mappings: [
			{ up: "packages/core", ours: "packages/node/core" },
			{ up: "packages/koishi", ours: "packages/node/cli" },
			{
				up: "packages/loader",
				ours: "packages/node/loader",
			},
			{ up: "packages/utils", ours: "packages/node/utils" },
			{
				up: "packages/i18n-utils",
				ours: "packages/node/i18n-utils",
			},
			{
				up: "plugins/hmr",
				ours: "plugins/infra/hmr",
				note: "本仓 Bun 原生化重写，diff 仅作线索",
			},
			{ up: "plugins/mock", ours: "plugins/infra/mock" },
			{
				up: "plugins/common",
				ours: "plugins/common",
				glob: true,
			},
			{
				up: "plugins/http",
				ours: "plugins/infra/http",
				skipDiff: true,
				note: "vendored 预编译产物",
			},
			{
				up: "plugins/proxy-agent",
				ours: "plugins/infra/proxy",
				skipDiff: true,
				note: "vendored 预编译产物（上游目录名不同）",
			},
			{
				up: "plugins/server",
				ours: "plugins/infra/server",
				skipDiff: true,
				note: "vendored 预编译产物",
			},
		],
	},
	{
		name: "webui",
		url: "https://github.com/koishijs/webui.git",
		baseline:
			"@koishijs/plugin-console@5.30.11 线；bootstrap 取 2026-06-27 main 快照，market 对齐 v2.11.11",
		mappings: [
			{
				up: "packages/console",
				ours: "packages/node/console",
			},
			{
				up: "packages/registry",
				ours: "packages/node/registry",
			},
			{
				up: "packages/client",
				ours: "packages/web/client",
				note: "本仓 devMode fork，diff 仅作线索",
			},
			{
				up: "packages/components",
				ours: "packages/web/components",
			},
			{
				up: "plugins/*",
				ours: "plugins/webui/*",
				glob: true,
				note: "market 客户端视图为本地化 fork，禁止整覆盖",
			},
		],
	},
	{
		name: "assets",
		url: "https://github.com/koishijs/assets.git",
		baseline:
			"@koishijs/assets@1.1.2（上游 2024-05 起停滞）",
		mappings: [
			{ up: "packages/core", ours: "packages/node/assets" },
			{
				up: "packages/local",
				ours: "plugins/common/assets-local",
			},
		],
	},
	{
		name: "common",
		url: "https://github.com/koishijs/common.git",
		baseline:
			"@koishijs/plugin-rate-limit@1.3.3 线（monorepo 内 2.x）",
		mappings: [
			{
				up: "packages/rate-limit",
				ours: "plugins/common/rate-limit",
			},
		],
	},
	{
		name: "cron",
		url: "https://github.com/koishijs/koishi-plugin-cron.git",
		baseline: "仅参考：本仓以 Bun.cron 原生重写，非移植",
		mappings: [],
	},
	{
		name: "cordiverse-server",
		url: "https://github.com/cordiverse/server.git",
		baseline:
			"@koishijs/plugin-server-temp@1.5.0；上游 2025-03-19 起删除了 temp 包（线已死，仅存档）",
		mappings: [
			{
				up: "packages/temp",
				ours: "plugins/infra/server-temp",
			},
		],
	},
	{
		name: "dataview",
		url: "https://github.com/koishijs/koishi-plugin-dataview.git",
		baseline: "koishi-plugin-dataview@2.7.8",
		mappings: [{ up: ".", ours: "plugins/webui/dataview" }],
	},
	{
		name: "theme-vanilla",
		url: "https://github.com/koishijs/koishi-plugin-theme-vanilla.git",
		baseline:
			"koishi-plugin-theme-vanilla@1.1.0（仓库已由 theme-vanilla 改名）",
		mappings: [
			{ up: ".", ours: "plugins/webui/theme-vanilla" },
		],
	},
	{
		name: "database",
		url: "https://github.com/cordiverse/database.git",
		baseline:
			"3 线 @minatojs/driver-memory@3.7.0 / driver-sqlite@4.7.0；仓库已由 cordiverse/minato 改名，master 为 cordis 4 线",
		mappings: [
			{
				up: "packages/memory",
				ours: "plugins/infra/memory",
				note: "两源合并之一（驱动实现），master 已 4 线",
			},
			{
				up: "packages/sqlite",
				ours: "plugins/infra/sqlite",
				note: "三源合并之一（3 线驱动），master 已 4 线",
			},
		],
	},
	{
		name: "koishijs-upstream",
		url: "https://github.com/koishijs/upstream.git",
		baseline:
			"memory / sqlite 包装层 3.7.0 / 4.7.0（re-export 三行，多年未动）",
		mappings: [
			{
				up: "database/memory",
				ours: "plugins/infra/memory",
				note: "两源合并之一（包装层）",
			},
			{
				up: "database/sqlite",
				ours: "plugins/infra/sqlite",
				note: "三源合并之一（包装层）",
			},
		],
	},
];
