// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * `koishi-scripts update`：宿主项目的安全依赖更新。
 *
 * 裸 `bun update` 是全树更新语义——市场安装的第三方插件与其全部传递
 * 依赖都会被拉动重解，任一上游漂移即可破坏运行时。下游项目实际需要
 * 跟随的只有 @koishi-ce/* 生态位，本命令以此为白名单显式执行
 * `bun update <pkg...>`（Bun 对指定包的更新只重解列出的目标）。
 *
 * 白名单外一律不碰：
 * - 四行 npm alias 冻结线（koishi / @koishijs/* → shim，版本跟随上游
 *   线，升线属人工决策，不自动）；
 * - 市场安装的 koishi-plugin-*（版本由插件市场操作）；
 * - bun-types（跟随本机 Bun 版本）。
 */
import type { PackageJson } from "./index.ts";
import { cwd, loadHostManifest } from "./index.ts";
import { runCommand } from "./release/run.ts";

/** CE 生态位包名前缀：唯一会被更新的目标集合 */
const CE_SCOPE = "@koishi-ce/";

/**
 * 收集宿主清单里的 @koishi-ce/* 依赖键（dependencies 与
 * devDependencies 合并、去重、排序，输出稳定）。
 */
export function collectUpdateTargets(
	manifest: PackageJson,
): string[] {
	return [
		...new Set([
			...Object.keys(manifest.dependencies ?? {}),
			...Object.keys(manifest.devDependencies ?? {}),
		]),
	]
		.filter((name) => name.startsWith(CE_SCOPE))
		.sort();
}

/** 主流程：读宿主清单 → 白名单收集 → 显式指定包执行 bun update。 */
export default async function runUpdate(): Promise<number> {
	const manifest = await loadHostManifest();
	if (!manifest) {
		console.log(
			"[update] 当前目录下无 package.json，请在宿主项目根执行",
		);
		return 1;
	}
	const targets = collectUpdateTargets(manifest);
	if (targets.length === 0) {
		console.log(
			"[update] 未发现 @koishi-ce/* 依赖，无需更新",
		);
		return 0;
	}
	console.log(
		`[update] 📦 更新 ${targets.length} 个 @koishi-ce/* 依赖（alias 冻结线与市场插件不受影响）`,
	);
	const code = runCommand(cwd, "bun", [
		"update",
		...targets,
	]);
	if (code !== 0) {
		console.log(
			`[update] ❌ bun update 失败（退出码 ${code}）`,
		);
	}
	return code;
}
