// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

// build / test 环：根 tsdown → 宿主控制台总装 → 各 webui 插件前端并发构建。
// webui 插件 dist 不入 git，发布前必须现构建——build 环遗漏任一插件都会导
// 致发布缺前端，故 targets 由 files 字段自动推导而非手工列举。
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Options } from "../core/options.ts";
import { ROOT } from "../core/options.ts";
import { run, runPool } from "../core/utils.ts";
import type { PkgInfo } from "../core/workspace.ts";
import { discoverPackages } from "../core/workspace.ts";

/** webui 插件前端的并发构建数（vite 单构建内存可观，不宜拉满）。 */
const BUILD_CONCURRENCY = 4;

/** webui 插件中需要 vite 构建前端 dist 的子集（console 由宿主总装覆盖）。 */
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

/** build 环：根 tsdown → 宿主控制台总装 → 各 webui 插件前端（失败即中断）。 */
export async function runBuildSteps(
	options: Options,
): Promise<number> {
	if (options.dryRun) {
		const targets = frontendTargets(discoverPackages(ROOT));
		const listed = targets
			.map((pkg) => `  • ${pkg.name}`)
			.join("\n");
		console.log(
			`[build] [dry-run] 将执行：根 tsdown → 宿主控制台总装 → ${targets.length} 个插件前端${targets.length > 0 ? `\n${listed}` : ""}`,
		);
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
		["packages/web/builder/src/bin.ts", "build"],
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
						"packages/web/builder/src/bin.ts",
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

/** test 环：自有用例子集（与 CI 门禁同口径）。 */
export async function runTestStep(): Promise<number> {
	console.log(
		"[test] 🧪 bun test --isolate（packages + common + admin + commands）",
	);
	return await run(
		process.execPath,
		[
			"test",
			// --isolate 不可省：缺了跨文件 mock.module 会互相串扰
			"--isolate",
			"packages",
			"plugins/common",
			"plugins/webui/admin",
			"plugins/webui/commands",
		],
		ROOT,
	);
}
