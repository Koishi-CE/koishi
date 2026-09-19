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

/**
 * 上游名 overrides 兜底层（清单与脚手架模板的 UPSTREAM_OVERRIDES 刻意
 * 克隆，语义见彼处注释，对账测试防漂移）：钉名靠落盘版本满足声明，
 * overrides 不看版本满足性强制重写整棵依赖树——第三方插件声明钉名
 * 清单外的上游名（如 @koishijs/plugin-admin）或超出冻结线的范围时，
 * 官方包仍会落盘污染 junction 布局，由本层兜住。
 */
const UPSTREAM_OVERRIDE_TARGETS: Record<string, string> = {
	koishi: "@koishi-ce/koishi",
	"@koishijs/core": "@koishi-ce/koishi",
	"@koishijs/loader": "@koishi-ce/koishi",
	"@koishijs/utils": "@koishi-ce/utils",
	"@koishijs/i18n-utils": "@koishi-ce/i18n-utils",
	"@koishijs/client": "@koishi-ce/client",
	"@koishijs/components": "@koishi-ce/components",
	"@koishijs/console": "@koishi-ce/console",
	"@koishijs/registry": "@koishi-ce/registry",
	"@koishijs/plugin-console": "@koishi-ce/plugin-console",
	"@koishijs/plugin-assets": "@koishi-ce/assets",
};

// CE 与上游同名再分发的 plugin-*：机械一一对应
for (const name of [
	"actions",
	"admin",
	"analytics",
	"assets-local",
	"auth",
	"bind",
	"broadcast",
	"callme",
	"commands",
	"config",
	"database-sqlite",
	"dataview",
	"echo",
	"explorer",
	"help",
	"hmr",
	"insight",
	"inspect",
	"locales",
	"logger",
	"market",
	"mock",
	"notifier",
	"oobe",
	"proxy-agent",
	"rate-limit",
	"sandbox",
	"server",
	"server-temp",
	"status",
]) {
	UPSTREAM_OVERRIDE_TARGETS[`@koishijs/plugin-${name}`] =
		`@koishi-ce/plugin-${name}`;
}

/** 生成沙盒 overrides 块：键为上游名，值统一 npm:<CE 包>@^1.0.0。 */
function buildUpstreamOverrides(): Record<string, string> {
	return Object.fromEntries(
		Object.entries(UPSTREAM_OVERRIDE_TARGETS).map(
			([name, target]) => [name, `npm:${target}@^1.0.0`],
		),
	);
}

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
		overrides: buildUpstreamOverrides(),
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
