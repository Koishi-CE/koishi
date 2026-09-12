// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/** build / test 环：根 tsdown、宿主控制台总装、webui 插件前端并发构建。 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Options } from "./options.ts";
import { ROOT } from "./options.ts";
import { run } from "./proc.ts";
import { runPool } from "./shared.ts";
import type { PkgInfo } from "./workspace.ts";
import { discoverPackages } from "./workspace.ts";

/** webui 插件前端的并发构建数（vite 单构建内存可观，不宜拉满）。 */
const BUILD_CONCURRENCY = 4;

/** webui 插件中需要 vite 构建前端 dist 的子集（files 含 dist 且有 client/；console 由宿主总装覆盖）。 */
function frontendTargets(
	pkgs: readonly PkgInfo[],
): PkgInfo[] {
	const webuiRoot = join(ROOT, "plugins", "webui");
	return pkgs.filter(
		(pkg) =>
			pkg.dir.startsWith(webuiRoot) &&
			pkg.files.includes("dist") &&
			existsSync(join(pkg.dir, "client")) &&
			pkg.name !== "@koishi-ce/plugin-console",
	);
}

/** build 环：根 tsdown → 宿主控制台总装 → 各 webui 插件前端（并发池，失败即中断）。 */
export async function runBuildSteps(
	options: Options,
): Promise<number> {
	if (options.dryRun) {
		const targets = frontendTargets(discoverPackages(ROOT));
		console.log(
			`[build] [dry-run] 将执行：根 tsdown → 宿主控制台总装 → ${targets.length} 个插件前端`,
		);
		for (const pkg of targets) {
			console.log(`  • ${pkg.name}`);
		}
		return 0;
	}
	console.log(
		"[build] 🔨 根 tsdown：全部 node 侧包 → lib/",
	);
	let code = await run(
		process.execPath,
		["run", "build"],
		ROOT,
	);
	if (code !== 0) {
		console.log(`[build] ❌ 根构建失败（退出码 ${code}）`);
		return code;
	}
	console.log(
		"[build] 🔨 宿主控制台前端总装 → plugins/webui/console/dist",
	);
	code = await run(
		process.execPath,
		["packages/web/client/src/bin.ts", "build"],
		ROOT,
	);
	if (code !== 0) {
		console.log(
			`[build] ❌ 宿主控制台总装失败（退出码 ${code}）`,
		);
		return code;
	}
	const targets = frontendTargets(discoverPackages(ROOT));
	console.log(
		`[build] 🔨 ${targets.length} 个 webui 插件前端 dist（并发 ${BUILD_CONCURRENCY}）`,
	);
	const startedAt = Date.now();
	try {
		await runPool(
			targets,
			BUILD_CONCURRENCY,
			async (pkg) => {
				const pluginCode = await run(
					process.execPath,
					[
						"packages/web/client/src/bin.ts",
						"build",
						pkg.dir,
					],
					ROOT,
				);
				if (pluginCode !== 0) {
					throw new Error(
						`${pkg.name} 前端构建失败（退出码 ${pluginCode}）`,
					);
				}
				console.log(`[build]   ✅ ${pkg.name}`);
			},
		);
	} catch (err) {
		const message =
			err instanceof Error ? err.message : String(err);
		console.log(`[build] ❌ ${message}，已中断`);
		return 1;
	}
	console.log(
		`[build] ✅ 构建完成（${((Date.now() - startedAt) / 1000).toFixed(1)}s）`,
	);
	return 0;
}

/** test 环：全量自有用例（与 AGENTS 门禁命令一致）。 */
export async function runTestStep(): Promise<number> {
	console.log(
		"[test] 🧪 bun test（packages + common + admin + commands）",
	);
	return await run(
		process.execPath,
		[
			"test",
			"packages",
			"plugins/common",
			"plugins/webui/admin",
			"plugins/webui/commands",
		],
		ROOT,
	);
}
