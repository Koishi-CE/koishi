// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/** status 子命令：pending changeset、本地版本 vs registry、发布序。 */
import { ROOT } from "./options.ts";
import { probeRegistry, REGISTRY } from "./registry.ts";
import {
	fetchAllPublished,
	filterDowngrades,
} from "./shared.ts";
import {
	countPendingChangesets,
	discoverPackages,
	planPublish,
	topoSort,
} from "./workspace.ts";

/** status：只读概览。 */
export async function cmdStatus(): Promise<number> {
	const pkgs = discoverPackages(ROOT);
	const pending = countPendingChangesets(ROOT);
	console.log(
		`[status] 可发布包 ${pkgs.length} 个；pending changeset ${pending.count} 个`,
	);
	for (const file of pending.files) {
		console.log(`  • ${file}`);
	}
	if (!(await probeRegistry())) {
		process.stderr.write(
			`[status] ⚠️ registry 不可达（${REGISTRY}），仅展示本地状态\n`,
		);
		return 0;
	}
	const published = await fetchAllPublished(
		pkgs,
		"[status]",
	);
	const plan = planPublish(pkgs, published);
	const { toPublish, downgraded } = filterDowngrades(
		plan,
		published,
	);
	const fresh = toPublish.filter(
		(pkg) => (published.get(pkg.name)?.size ?? 0) === 0,
	);
	if (downgraded.length > 0) {
		console.log(
			`[status] ⚠️ 本地版本低于 registry（${downgraded.length} 个，需排查）：`,
		);
		for (const pkg of downgraded) {
			console.log(`  ${pkg.name}@${pkg.version}`);
		}
	}
	if (toPublish.length > 0) {
		console.log(
			`[status] 待发布 ${toPublish.length} 个（其中首发 ${fresh.length} 个），发布序：`,
		);
		for (const pkg of topoSort(toPublish)) {
			console.log(
				`  ${pkg.name}@${pkg.version}${fresh.includes(pkg) ? "（首发）" : ""}`,
			);
		}
	} else {
		console.log("[status] 全部包已与 registry 同步");
	}
	console.log(`[status] 已同步 ${plan.skipped.length} 个`);
	return 0;
}
