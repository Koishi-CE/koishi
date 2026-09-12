// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/** version 子命令：changeset 消费、lockfile 刷新与版本提交。 */
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { Options } from "./options.ts";
import { ROOT } from "./options.ts";
import { capture, run } from "./proc.ts";
import {
	countPendingChangesets,
	discoverPackages,
} from "./workspace.ts";

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
		console.log("[pipeline] 版本相关文件无变化，跳过提交");
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
		console.log("[pipeline] ✅ 版本变化已提交");
	}
	return code;
}
