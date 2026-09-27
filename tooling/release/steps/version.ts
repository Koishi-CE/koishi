// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/** version 子命令：changeset 消费、lockfile 刷新与版本提交。 */
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { Options } from "../core/options.ts";
import { ROOT } from "../core/options.ts";
import { capture, run } from "../core/proc.ts";
import {
	countPendingChangesets,
	discoverPackages,
} from "../core/workspace.ts";

/** version 环的实际执行；bumpedDirs 供 pipeline 提交版本变化用。 */
export async function runVersion(
	options: Options,
): Promise<{
	code: number;
	consumed: boolean;
	bumpedDirs: string[];
}> {
	const pending = countPendingChangesets(ROOT);
	if (pending.count === 0) {
		console.log("[version] 无 pending changeset，跳过");
		return { code: 0, consumed: false, bumpedDirs: [] };
	}
	if (options.dryRun) {
		console.log(
			`[version] [dry-run] 将执行 changeset version 消费 ${pending.count} 个条目，随后 bun install 刷新 lockfile`,
		);
		return { code: 0, consumed: false, bumpedDirs: [] };
	}
	const bin = join(
		ROOT,
		"node_modules",
		"@changesets",
		"cli",
		"bin.js",
	);
	if (!existsSync(bin)) {
		process.stderr.write(
			"[version] ❌ 未找到 @changesets/cli（先 bun install）\n",
		);
		return { code: 1, consumed: false, bumpedDirs: [] };
	}
	const before = new Map(
		discoverPackages(ROOT).map((pkg) => [
			pkg.name,
			pkg.version,
		]),
	);
	console.log(
		`[version] 📦 消费 ${pending.count} 个条目：changeset version`,
	);
	let code = await run(
		process.execPath,
		[bin, "version"],
		ROOT,
	);
	if (code !== 0) {
		console.log(
			`[version] ❌ changeset version 失败（退出码 ${code}）`,
		);
		return { code, consumed: false, bumpedDirs: [] };
	}
	console.log(
		"[version] 🔒 bun install 刷新 bun.lock（workspace 版本已变）",
	);
	code = await run(process.execPath, ["install"], ROOT);
	if (code !== 0) {
		console.log(
			`[version] ❌ bun install 失败（退出码 ${code}）`,
		);
		return { code, consumed: true, bumpedDirs: [] };
	}
	const after = discoverPackages(ROOT);
	const bumpedDirs: string[] = [];
	for (const pkg of after) {
		if (before.get(pkg.name) !== pkg.version) {
			bumpedDirs.push(relative(ROOT, pkg.dir));
		}
	}
	if (bumpedDirs.length === 0) {
		console.log(
			"[version] ⚠️ 条目已消费但无版本变化（可能全部命中 ignore）",
		);
	} else {
		console.log(
			`[version] ✅ ${bumpedDirs.length} 个包升版本：`,
		);
		for (const pkg of after) {
			const old = before.get(pkg.name);
			if (old !== undefined && old !== pkg.version) {
				console.log(
					`  ${pkg.name}: ${old} → ${pkg.version}`,
				);
			}
		}
	}
	return { code: 0, consumed: true, bumpedDirs };
}

/** 把版本相关变化提交（只 add 版本相关路径，绝不 git add -A——防 --allow-dirty 时卷入无关改动）。 */
export async function commitVersionBumps(
	bumpedDirs: readonly string[],
): Promise<number> {
	const candidates = [
		".changeset",
		"bun.lock",
		"package.json",
	];
	for (const dir of bumpedDirs) {
		candidates.push(
			join(dir, "package.json"),
			join(dir, "CHANGELOG.md"),
		);
	}
	const addPaths = candidates.filter((p) =>
		existsSync(join(ROOT, p)),
	);
	await run("git", ["add", ...addPaths], ROOT);
	const staged = (
		capture(
			"git",
			["diff", "--cached", "--name-only"],
			ROOT,
		) ?? ""
	).trim();
	if (staged === "") {
		console.log("[version] 版本相关文件无变化，跳过提交");
		return 0;
	}
	const code = await run(
		"git",
		[
			"commit",
			"-m",
			"chore(release): 消费 changeset，升版本并更新 CHANGELOG",
		],
		ROOT,
	);
	if (code === 0) {
		console.log("[version] ✅ 版本变化已提交");
	}
	return code;
}

/**
 * version 子命令：消费 changeset，可选提交与推送。
 *
 * CI 里「构建」与「发布」必须拆成权限不同的两个 job（发布 job 才拿
 * id-token: write），一条 pipeline 串不完，故把提交与推送开放为旗标。
 *
 * 带 --commit / --push 时强制在 main 上：版本提交直推 main 是全仓唯一的
 * 既定例外（见 AGENTS.md 的 git 提交流程节），但绝不允许从别的分支
 * `--push` 把该分支的提交推到 main。
 */
export async function cmdVersion(
	options: Options,
): Promise<number> {
	// 护栏必须前置：若放在 runVersion 之后，在非 main 分支上执行
	// `version --commit` 会先把 changeset 白白消费掉、把工作区改脏，然后才
	// 拒绝——那已经不是「拒绝」，而是「半途改完再报错」。
	if (!options.dryRun && (options.commit || options.push)) {
		const branch = capture(
			"git",
			["rev-parse", "--abbrev-ref", "HEAD"],
			ROOT,
		)?.trim();
		if (branch !== "main") {
			process.stderr.write(
				`[version] ❌ --commit / --push 只能在 main 上执行（当前分支 ${branch ?? "未知"}）\n`,
			);
			return 1;
		}
	}
	const version = await runVersion(options);
	if (version.code !== 0) {
		return version.code;
	}
	if (
		options.dryRun ||
		(!options.commit && !options.push)
	) {
		return 0;
	}
	if (options.commit && version.consumed) {
		const commitCode = await commitVersionBumps(
			version.bumpedDirs,
		);
		if (commitCode !== 0) {
			return commitCode;
		}
	}
	if (options.push) {
		const code = await run(
			"git",
			["push", "origin", "main"],
			ROOT,
		);
		if (code !== 0) {
			console.log("[version] ❌ push main 失败");
			return code;
		}
		console.log("[version] 📤 已推送 main");
	}
	return 0;
}
