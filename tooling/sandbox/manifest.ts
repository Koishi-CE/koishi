// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 沙盒 package.json 生成。
 *
 * 上游名钉名（UPSTREAM_ALIASES）与 overrides 兜底层复用脚手架模板的
 * 单一真源（apps/koishi-create/src/template.ts，语义与维护纪律见彼处
 * 注释与 packages/shim/README.md）：沙盒经市场装插件会触发真实
 * bun install，无这两层防线时 Bun 会把 npm 官方 koishi / console /
 * client / components 全家桶装进沙盒，污染 junction 布局。对 link /
 * pack 两模式同样生效。
 */
import {
	buildUpstreamOverrides,
	UPSTREAM_ALIASES,
} from "../../apps/koishi-create/src/template.ts";

/** 打包模式的 tgz 落盘记录（生成 package.json dependencies 用）。 */
export interface PackEntry {
	name: string;
	/** tgz 文件名（如 koishi-ce-core-1.0.0.tgz）。 */
	file: string;
}

/** 链接模式预声明的默认插件依赖（与脚手架模板的默认启用集对齐）。 */
const DEFAULT_DEPS = [
	"@koishi-ce/plugin-http",
	"@koishi-ce/plugin-proxy-agent",
	"@koishi-ce/plugin-server",
] as const;

/**
 * 生成沙盒 package.json。scripts.start 直指 cli 入口文件而非 .bin：链接模式
 * 的 .bin 非 bun install 产物（win32 需 .exe stub，手工伪造不可靠），两模式
 * 统一直指文件路径，用户侧入口均为 `bun start`。
 *
 * 链接模式同样声明默认插件依赖（与脚手架模板一致）：loader 启动时会做
 * manifest 迁移（migrateManifest 按进程 cwd 读 package.json），发现宿主未
 * 声明这些插件就会自动补挂插件键并改写 koishi.yml，与模板 yml 里已有的
 * 同名键撞出 duplicate plugin 警告。声明版本取 workspace 包当前真实版本的
 * caret 区间（versions 未提供该包时回退 ^1.0.0，仅为测试直调形态兜底），
 * 主版本升级后不会静默漂移。打包模式的 dependencies 即全部 tgz（file:
 * 协议），天然覆盖这些键。
 */
export function buildSandboxPackageJson(
	mode: "link" | "pack",
	packed?: PackEntry[],
	versions?: ReadonlyMap<string, string>,
): Record<string, unknown> {
	const dependencies: Record<string, string> = {};
	if (mode === "link") {
		for (const name of DEFAULT_DEPS) {
			const version = versions?.get(name);
			dependencies[name] = version
				? `^${version}`
				: "^1.0.0";
		}
	} else {
		for (const entry of packed ?? []) {
			dependencies[entry.name] =
				`file:./vendor/${entry.file}`;
		}
	}
	return {
		name: "koishi-ce-sandbox",
		version: "0.0.0",
		private: true,
		type: "module",
		scripts: {
			start:
				"bun node_modules/@koishi-ce/koishi/lib/cli/index.mjs start",
		},
		dependencies: {
			...dependencies,
			...UPSTREAM_ALIASES,
		},
		overrides: buildUpstreamOverrides(),
	};
}
