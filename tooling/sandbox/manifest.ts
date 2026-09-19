// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/** 打包模式的 tgz 落盘记录（生成 package.json dependencies 用）。 */
export interface PackEntry {
	name: string;
	/** tgz 文件名（如 koishi-ce-core-1.0.0.tgz）。 */
	file: string;
}

/**
 * 生成沙盒 package.json。scripts.start 直指 cli 入口文件而非 .bin：链接模式
 * 的 .bin 非 bun install 产物（win32 需 .exe stub，手工伪造不可靠），两模式
 * 统一直指文件路径，用户侧入口均为 `bun start`。
 *
 * 链接模式同样声明默认插件依赖（与脚手架模板一致）：loader 启动时会做
 * manifest 迁移（migrateManifest 按进程 cwd 读 package.json），发现宿主未
 * 声明这些插件就会自动补挂插件键并改写 koishi.yml，与模板 yml 里已有的
 * 同名键撞出 duplicate plugin 警告。打包模式的 dependencies 即全部 tgz，
 * 天然包含这三个键；两种模式都预置上游名 alias 钉名（market 安装防线）。
 */
/**
 * 上游名 npm alias 钉名（与脚手架模板逐字同构，语义见
 * apps/koishi-create/src/template.ts 与 packages/shim/README.md）。
 *
 * 沙盒经市场装插件会触发真实 bun install，无钉名时 Bun 会装下 npm
 * 官方 koishi / console / client / components 全家桶（2026-09-19
 * napuketto 实证），污染 junction 布局；两模式共用同一份。
 */
const UPSTREAM_ALIASES: Record<string, string> = {
	koishi: "npm:@koishi-ce/koishi-shim@^4.18.11",
	"@koishijs/core": "npm:@koishi-ce/koishi-shim@4.18.11",
	"@koishijs/loader": "npm:@koishi-ce/koishi-shim@^4.18.11",
	"@koishijs/plugin-console":
		"npm:@koishi-ce/console-shim@^5.30.11",
	"@koishijs/client": "npm:@koishi-ce/client-shim@^5.30.11",
	"@koishijs/components":
		"npm:@koishi-ce/components-shim@^1.5.22",
};

export function buildSandboxPackageJson(
	mode: "link" | "pack",
	packed?: PackEntry[],
): Record<string, unknown> {
	const manifest: Record<string, unknown> = {
		name: "koishi-ce-sandbox",
		version: "0.0.0",
		private: true,
		type: "module",
		scripts: {
			start:
				"bun node_modules/@koishi-ce/koishi/lib/cli/index.mjs start",
		},
		dependencies: {
			"@koishi-ce/plugin-http": "^1.0.0",
			"@koishi-ce/plugin-proxy-agent": "^1.0.0",
			"@koishi-ce/plugin-server": "^1.0.0",
			...UPSTREAM_ALIASES,
		},
	};
	if (mode === "pack") {
		const dependencies: Record<string, string> = {};
		for (const entry of packed ?? []) {
			dependencies[entry.name] =
				`file:./vendor/${entry.file}`;
		}
		manifest["dependencies"] = {
			...dependencies,
			...UPSTREAM_ALIASES,
		};
	}
	return manifest;
}
