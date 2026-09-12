// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import {
	lstatSync,
	mkdirSync,
	realpathSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { SCOPE } from "./config.ts";
import type { WorkspacePackage } from "./workspace.ts";

/** 单条链接的动作判定（planLinks 产出）。 */
export interface LinkPlanEntry {
	name: string;
	/** 链接落点（沙盒 node_modules 内）。 */
	link: string;
	/** 链接目标（工作区包目录绝对路径）。 */
	target: string;
	/** create 新建 / keep 已一致 / rebuild 指向错误须重建 / skip-entity 实体目录让位。 */
	action: "create" | "keep" | "rebuild" | "skip-entity";
}

/**
 * 为全部 CE 作用域包生成链接计划：链接名取去作用域后的短名
 * （@koishi-ce/core → node_modules/@koishi-ce/core）。
 *
 * 判定规则：
 * - 不存在 → create；
 * - junction/symlink 且真实路径与目标一致 → keep；
 * - junction/symlink 但指向不同 → rebuild；
 * - 实体目录/文件（如市场装出的 npm 包）→ skip-entity，绝不覆盖用户主动安装。
 */
export function planLinks(
	packages: WorkspacePackage[],
	nodeModulesDir: string,
): LinkPlanEntry[] {
	const scopedRoot = join(nodeModulesDir, SCOPE);
	const plan: LinkPlanEntry[] = [];
	for (const pkg of packages) {
		if (!pkg.name.startsWith(SCOPE)) continue;
		const short = pkg.name.slice(SCOPE.length);
		const link = join(scopedRoot, short);
		const target = pkg.dir;
		let action: LinkPlanEntry["action"] = "create";
		// 用 lstat 判存在而非 existsSync：后者对悬空 junction（目标已删）返回
		// false，会误判为 create 并在 symlinkSync 时抛 EEXIST
		let stats: ReturnType<typeof lstatSync>;
		try {
			stats = lstatSync(link);
		} catch {
			stats = undefined;
		}
		if (stats?.isSymbolicLink()) {
			try {
				// 两侧统一小写比较（win32 盘符与路径大小写形态可能不一致）
				const current = realpathSync(link).toLowerCase();
				action =
					current === target.toLowerCase()
						? "keep"
						: "rebuild";
			} catch {
				// 悬空 junction：目标不存在，直接重建
				action = "rebuild";
			}
		} else if (stats) {
			action = "skip-entity";
		}
		plan.push({ name: pkg.name, link, target, action });
	}
	return plan;
}

/** 执行链接计划，返回各动作的计数（用于摘要输出）。 */
export function applyLinks(
	plan: LinkPlanEntry[],
): Record<string, number> {
	const counts = {
		create: 0,
		keep: 0,
		rebuild: 0,
		"skip-entity": 0,
	};
	for (const entry of plan) {
		if (entry.action === "rebuild") {
			rmSync(entry.link, { recursive: true, force: true });
		}
		if (
			entry.action === "create" ||
			entry.action === "rebuild"
		) {
			mkdirSync(dirname(entry.link), { recursive: true });
			symlinkSync(entry.target, entry.link, "junction");
		}
		counts[entry.action]++;
	}
	return counts;
}
