// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 跨子命令共用的高层步骤：registry 全量比对、有界并发池、
 * 降级过滤。status 与 publish 都以「比对 registry → 过滤降级包」
 * 起步，收敛于此避免两份漂移。
 */
import { fetchPublishedVersions } from "./registry.ts";
import type { PkgInfo, PublishPlan } from "./workspace.ts";
import { isDowngrade } from "./workspace.ts";

/** 并行查询全部包的 registry 版本集（包名 → 已发布版本集合）。 */
export async function fetchAllPublished(
	pkgs: readonly PkgInfo[],
	prefix: string,
): Promise<Map<string, Set<string>>> {
	console.log(
		`${prefix} 🔍 正在比对 registry 已发布版本（${pkgs.length} 个包）…`,
	);
	const startedAt = Date.now();
	const map = new Map<string, Set<string>>();
	await Promise.all(
		pkgs.map(async (pkg) => {
			map.set(
				pkg.name,
				await fetchPublishedVersions(pkg.name),
			);
		}),
	);
	console.log(
		`${prefix} ✅ 比对完成（${((Date.now() - startedAt) / 1000).toFixed(1)}s）`,
	);
	return map;
}

/** 有界并发池：失败即停止调度新任务，等在跑任务收尾后抛出首个错误。 */
export async function runPool<T>(
	items: readonly T[],
	limit: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	let next = 0;
	let failed = false;
	let firstError: unknown;
	async function lane(): Promise<void> {
		while (!failed) {
			const item = items[next];
			next += 1;
			if (item === undefined) {
				return;
			}
			try {
				await worker(item);
			} catch (err) {
				if (!failed) {
					failed = true;
					firstError = err;
				}
				return;
			}
		}
	}
	await Promise.all(
		Array.from(
			{ length: Math.min(limit, items.length) },
			() => lane(),
		),
	);
	if (firstError !== undefined) {
		throw firstError;
	}
}

/**
 * 把发布计划中本地版本低于 registry 已发布版本的包（降级包）从
 * 待发布列表剔除；返回剔除后的待发布列表与被剔除的降级包
 * （后者由调用方决定记入 skipped 还是单独告警）。
 */
export function filterDowngrades(
	plan: PublishPlan,
	published: Map<string, Set<string>>,
): { toPublish: PkgInfo[]; downgraded: PkgInfo[] } {
	const downgraded = plan.toPublish.filter((pkg) =>
		isDowngrade(
			pkg.version,
			published.get(pkg.name) ?? new Set<string>(),
		),
	);
	const toPublish = plan.toPublish.filter(
		(pkg) => !downgraded.includes(pkg),
	);
	return { toPublish, downgraded };
}
