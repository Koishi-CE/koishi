// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

// workspace 包发现与发布计划纯逻辑（文件系统访问集中在 discover / read*
// 函数，其余全是纯函数）。包发现复用 shared/workspace.ts 的统一实现（根
// package.json 的 workspaces globs 为唯一事实源），private 包在此排除。
// 发布序按内部依赖（dependencies / optionalDependencies 命中 workspace
// 包名者）拓扑排序，被依赖者在前；peerDependencies 刻意不入边——peer 是
// 消费方运行时自备的兼容声明，且框架⇄插件互 peer（koishi 依赖 server、
// server peer koishi）纳入排序必成环，发布链会因此整体中断。
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { CatalogSpecs } from "../../shared/workspace.ts";
import {
	discoverWorkspaceDirs,
	readJsonFile,
} from "../../shared/workspace.ts";

/** 工作区内一个可发布包（非 private、含 name 与 version）。 */
export interface PkgInfo {
	/** npm 包名。 */
	name: string;
	/** 当前版本号。 */
	version: string;
	/** 包目录绝对路径。 */
	dir: string;
	/** package.json 绝对路径。 */
	manifestPath: string;
	dependencies: Record<string, string>;
	peerDependencies: Record<string, string>;
	optionalDependencies: Record<string, string>;
	/** files 白名单（构建编排判断是否需要前端 dist）。 */
	files: readonly string[];
}

/** 发布计划（skipped 由调用方按跳过原因追加）。 */
export interface PublishPlan {
	/** 需要发布的包（保持入参顺序）。 */
	toPublish: PkgInfo[];
	/** 跳过的包与原因。 */
	skipped: { pkg: PkgInfo; reason: string }[];
}

/** 读取单个目录的 package.json；不可发布（无名/无版本/private）→ null。 */
function loadPkg(dir: string): PkgInfo | null {
	const manifest = readJsonFile(join(dir, "package.json"));
	const name = manifest?.["name"];
	const version = manifest?.["version"];
	if (
		typeof name !== "string" ||
		name === "" ||
		typeof version !== "string" ||
		version === "" ||
		manifest?.["private"] === true
	) {
		return null;
	}
	const record = (key: string): Record<string, string> => {
		const value = manifest?.[key];
		return typeof value === "object" && value !== null
			? (value as Record<string, string>)
			: {};
	};
	const files = manifest?.["files"];
	return {
		name,
		version,
		dir,
		manifestPath: join(dir, "package.json"),
		dependencies: record("dependencies"),
		peerDependencies: record("peerDependencies"),
		optionalDependencies: record("optionalDependencies"),
		files: Array.isArray(files)
			? files.filter(
					(item): item is string =>
						typeof item === "string",
				)
			: [],
	};
}

/**
 * 发现工作区全部可发布包（按目录路径排序，顺序稳定；private 包排除，
 * 目录枚举策略见 shared/workspace.ts——readdirSync 策略无 Bun.Glob 的
 * win32 空集怪癖）。
 */
export function discoverPackages(root: string): PkgInfo[] {
	return discoverWorkspaceDirs(root)
		.map(loadPkg)
		.filter((pkg): pkg is PkgInfo => pkg !== null);
}

/** 按内部依赖拓扑排序（Kahn）：被依赖者在前；存在环 → 抛错（发布链中断）。 */
export function topoSort(
	pkgs: readonly PkgInfo[],
): PkgInfo[] {
	const names = new Set(pkgs.map((pkg) => pkg.name));
	const byName = new Map(
		pkgs.map((pkg) => [pkg.name, pkg]),
	);
	const inDegree = new Map<string, number>();
	const dependents = new Map<string, string[]>();
	for (const pkg of pkgs) {
		const deps = [
			...new Set(
				[
					...Object.keys(pkg.dependencies),
					...Object.keys(pkg.optionalDependencies),
				].filter((name) => names.has(name)),
			),
		];
		inDegree.set(pkg.name, deps.length);
		for (const dep of deps) {
			dependents.set(dep, [
				...(dependents.get(dep) ?? []),
				pkg.name,
			]);
		}
	}
	const queue = pkgs
		.filter((pkg) => inDegree.get(pkg.name) === 0)
		.map((pkg) => pkg.name);
	const ordered: string[] = [];
	for (let head = 0; head < queue.length; head += 1) {
		const name = queue[head] as string;
		ordered.push(name);
		for (const dependent of dependents.get(name) ?? []) {
			const next = (inDegree.get(dependent) ?? 0) - 1;
			inDegree.set(dependent, next);
			if (next === 0) {
				queue.push(dependent);
			}
		}
	}
	if (ordered.length !== pkgs.length) {
		const cyclic = pkgs
			.map((pkg) => pkg.name)
			.filter((name) => !ordered.includes(name));
		throw new Error(
			`内部依赖存在环，无法确定发布顺序: ${cyclic.join(", ")}`,
		);
	}
	return ordered.map((name) => byName.get(name) as PkgInfo);
}

/** 计算发布计划：本地版本已在 registry → 跳过，否则待发布。 */
export function planPublish(
	pkgs: readonly PkgInfo[],
	published: ReadonlyMap<string, ReadonlySet<string>>,
): PublishPlan {
	const toPublish: PkgInfo[] = [];
	const skipped: PublishPlan["skipped"] = [];
	for (const pkg of pkgs) {
		if (published.get(pkg.name)?.has(pkg.version)) {
			skipped.push({
				pkg,
				reason: `版本 ${pkg.version} 已在 registry`,
			});
		} else {
			toPublish.push(pkg);
		}
	}
	return { toPublish, skipped };
}

/** 本地版本是否低于 registry 已发布版本（源码落后，npm 会拒绝隐式 latest）。 */
export function isDowngrade(
	local: string,
	published: ReadonlySet<string>,
): boolean {
	return [...published].some((version) => {
		try {
			// prerelease 参与比较（1.2.3-alpha < 1.2.3）；非法 semver 不可比
			return Bun.semver.order(version, local) > 0;
		} catch {
			return false;
		}
	});
}

/** 把降级包从发布计划剔除（由调用方记入 skipped）。 */
export function filterDowngrades(
	plan: PublishPlan,
	published: ReadonlyMap<string, ReadonlySet<string>>,
): { toPublish: PkgInfo[]; downgraded: PkgInfo[] } {
	const downgraded = plan.toPublish.filter((pkg) =>
		isDowngrade(
			pkg.version,
			published.get(pkg.name) ?? new Set<string>(),
		),
	);
	const downgradedSet = new Set(downgraded);
	return {
		toPublish: plan.toPublish.filter(
			(pkg) => !downgradedSet.has(pkg),
		),
		downgraded,
	};
}

/** package.json 中可含本地协议依赖的字段（发布前必须全部改写）。 */
const DEP_FIELDS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
] as const;

/** 单个依赖改写记录。 */
export interface WorkspaceRewrite {
	/** 所在字段。 */
	field: string;
	/** 依赖包名。 */
	dep: string;
	/** 改写后的版本范围。 */
	range: string;
}

/**
 * 把 manifest 文本中全部本地协议依赖改写为真实版本（npm 不认这些协议，
 * changeset version 不改写它们）：`workspace:*` → caret 真实版本（本仓约定
 * 仅此形式），`catalog:` / `catalog:<名>` → 根清单 catalog 定义的 spec（键
 * 缺失即抛错）。返回改写文本与记录；无改写时原样返回。末尾终局断言：依赖
 * 字段不得残留任何本地协议——改写逻辑再完备也要断言兜底，这是下游 install
 * 不被 `workspace:*` 毒害的最后防线。
 */
export function rewriteWorkspaceProtocol(
	raw: string,
	versions: ReadonlyMap<string, string>,
	catalogs: CatalogSpecs,
): { text: string; changes: WorkspaceRewrite[] } {
	const manifest = JSON.parse(raw) as Record<
		string,
		unknown
	>;
	const changes: WorkspaceRewrite[] = [];
	const editDeps = (
		rewrite: (
			field: string,
			dep: string,
			range: string,
		) => string | undefined,
	) => {
		for (const field of DEP_FIELDS) {
			const deps = manifest[field];
			if (typeof deps !== "object" || deps === null) {
				continue;
			}
			for (const [dep, range] of Object.entries(
				deps as Record<string, unknown>,
			)) {
				if (typeof range !== "string") {
					continue;
				}
				const next = rewrite(field, dep, range);
				if (next !== undefined) {
					(deps as Record<string, string>)[dep] = next;
					changes.push({ field, dep, range: next });
				}
			}
		}
	};
	editDeps((field, dep, range) => {
		if (range.startsWith("catalog:")) {
			const group = range.slice("catalog:".length);
			const spec =
				group === ""
					? catalogs.default.get(dep)
					: catalogs.named.get(group)?.get(dep);
			if (spec === undefined) {
				throw new Error(
					`${field}.${dep} 声明了 ${range}，但根清单 catalog 未定义该依赖（无法改写为真实版本），拒绝发布`,
				);
			}
			return spec;
		}
		if (!range.startsWith("workspace:")) {
			return undefined;
		}
		if (range !== "workspace:*") {
			throw new Error(
				`${dep} 声明了 ${range}（本仓库约定仅 workspace:*），拒绝发布`,
			);
		}
		const version = versions.get(dep);
		if (version === undefined) {
			throw new Error(
				`依赖 ${dep} 声明为 workspace:*，但工作区内不存在该包（无法改写为真实版本）`,
			);
		}
		return `^${version}`;
	});
	// 终局断言：改写后不得残留任何本地协议（含 file:/link: 等未经手改写的）
	editDeps((field, dep, range) => {
		if (/^(workspace|file|link|catalog):/.test(range)) {
			throw new Error(
				`${field}.${dep} 改写后仍残留本地协议 ${range}，拒绝发布`,
			);
		}
		return undefined;
	});
	return {
		text:
			changes.length > 0
				? `${JSON.stringify(manifest, null, 4)}\n`
				: raw,
		changes,
	};
}

/** .changeset/ 下待消费条目（*.md，README.md 除外）。 */
export function countPendingChangesets(root: string): {
	count: number;
	files: string[];
} {
	let names: string[] = [];
	try {
		names = readdirSync(join(root, ".changeset"));
	} catch {
		names = [];
	}
	const files = names
		.filter(
			(name) =>
				name.toLowerCase() !== "readme.md" &&
				name.toLowerCase().endsWith(".md"),
		)
		.sort();
	return { count: files.length, files };
}
