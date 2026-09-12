// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { runBuildSteps, runTestStep } from "./build.ts";
/** pipeline 子命令：preflight → version → 提交 → build → test → publish → push。 */
import type { Options } from "./options.ts";
import { ROOT } from "./options.ts";
import { capture, run } from "./proc.ts";
import { runPublishSteps } from "./publish.ts";
import { npmWhoami } from "./registry.ts";
import {
	commitVersionBumps,
	runVersion,
} from "./version.ts";

/** pipeline：一条龙。每环失败即中断；全部环节重跑幂等。 */
export async function cmdPipeline(
	options: Options,
): Promise<number> {
	console.log(
		`[pipeline] === 构建发布一条龙${options.dryRun ? "（dry-run）" : ""} ===`,
	);
	// preflight：分支 / 工作区洁净 / npm 登录
	const branch = capture(
		"git",
		["rev-parse", "--abbrev-ref", "HEAD"],
		ROOT,
	)?.trim();
	if (branch !== "main") {
		process.stderr.write(
			`[pipeline] ❌ 当前分支 ${branch ?? "未知"}，发布须在 main 上进行\n`,
		);
		return 1;
	}
	const dirty =
		(
			capture("git", ["status", "--porcelain"], ROOT) ?? ""
		).trim() !== "";
	if (dirty && !options.allowDirty && !options.dryRun) {
		process.stderr.write(
			"[pipeline] ❌ 工作区有未提交改动；先提交，或用 --allow-dirty 跳过检查\n",
		);
		return 1;
	}
	if (dirty) {
		process.stderr.write(
			"[pipeline] ⚠️ 工作区有未提交改动（继续执行；版本提交只含版本相关文件）\n",
		);
	}
	if (!options.dryRun) {
		const whoami = npmWhoami(ROOT);
		if (whoami === null) {
			process.stderr.write(
				"[pipeline] ❌ npm 未登录（先 npm login）\n",
			);
			return 1;
		}
		console.log(`[pipeline] npm 身份：${whoami}`);
	}

	// version 环 + 版本提交
	const version = await runVersion(options);
	if (version.code !== 0) {
		return version.code;
	}
	if (!options.dryRun && version.consumed) {
		const commitCode = await commitVersionBumps(
			version.bumpedDirs,
		);
		if (commitCode !== 0) {
			return commitCode;
		}
	}

	// build 环
	if (!options.skipBuild) {
		const buildCode = await runBuildSteps(options);
		if (buildCode !== 0) {
			return buildCode;
		}
	} else {
		console.log("[pipeline] ⏭ 跳过构建（--skip-build）");
	}

	// test 环
	if (!options.skipTest) {
		if (options.dryRun) {
			console.log(
				"[pipeline] [dry-run] 将执行 bun test（全量自有用例）",
			);
		} else {
			const testCode = await runTestStep();
			if (testCode !== 0) {
				console.log("[pipeline] ❌ 测试未通过，已中断");
				return testCode;
			}
		}
	} else {
		console.log("[pipeline] ⏭ 跳过测试（--skip-test）");
	}

	// publish 环
	const publishCode = await runPublishSteps(options);
	if (publishCode !== 0) {
		return publishCode;
	}

	if (options.dryRun) {
		console.log("[pipeline] [dry-run] 结束，未做任何变更");
		return 0;
	}

	// 推送
	if (options.push) {
		console.log("[pipeline] 📤 git push origin main");
		const code = await run(
			"git",
			["push", "origin", "main"],
			ROOT,
		);
		if (code !== 0) {
			console.log("[pipeline] ❌ push main 失败");
			return code;
		}
	} else {
		console.log(
			"[pipeline] 完成。尚未推送：git push origin main",
		);
	}
	return 0;
}
