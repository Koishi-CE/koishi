// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * publish 链核心逻辑（纯函数，可单测）。
 *
 * 职责：发现工作区内可发布的包，按内部依赖拓扑排序——被依赖的包先发布、
 * 依赖者后发布，保证 npm 逐个发包时解析到的是刚发布的新版本（npm 不像
 * pnpm -r 那样自动按拓扑序递归）。
 *
 * 只发布版本有变化的包：本地版本已存在于 registry → 跳过（changeset
 * 未 bump 的包版本不变，不应重复发布，否则 npm 报
 * "cannot publish over the previously published versions"）。
 *
 * 纯函数不访问网络；文件系统访问集中在 discoverPackages（接收根目录
 * 参数，便于单测用临时目录模拟工作区）。
 */
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** 工作区内一个可发布包。 */
export interface WorkspacePkg {
	/** npm 包名（package.json name）。 */
	name: string;
	/** 包目录绝对路径。 */
	dir: string;
	/** 当前版本号。 */
	version: string;
	/** dependencies 表（含 workspace:* 协议引用与 ^x.y.z 等范围）。 */
	dependencies: Record<string, string>;
}

/** 展开根目录下一个 base 目录的直接子目录列表；base 不存在 → 空数组。 */
async function expandGlobDirs(root: string, base: string): Promise<string[]> {
	const full = join(root, base);
	let entries: Dirent[];
	try {
		entries = await readdir(full, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(full, entry.name));
}

/**
 * 读取单目录下的 package.json。
 * 无 package.json / 无 name / private 包 → null（不可发布）。
 */
async function loadPackage(dir: string): Promise<WorkspacePkg | null> {
	let raw: string;
	try {
		raw = await readFile(join(dir, "package.json"), "utf8");
	} catch {
		return null;
	}
	const pkg = JSON.parse(raw) as {
		name?: unknown;
		private?: unknown;
		version?: unknown;
		dependencies?: unknown;
	};
	if (typeof pkg.name !== "string" || pkg.name === "" || pkg.private === true) {
		return null;
	}
	return {
		name: pkg.name,
		dir,
		version: typeof pkg.version === "string" ? pkg.version : "0.0.0",
		dependencies:
			pkg.dependencies === undefined
				? {}
				: (pkg.dependencies as Record<string, string>),
	};
}

/**
 * 发现工作区全部可发布包（原始顺序，未排序）：
 *   external/<项目>/          —— 单包插件
 *   external/<monorepo>/packages/<子包>/ —— monorepo 的子包
 * monorepo 根包为 private，由 loadPackage 自动过滤。
 */
export async function discoverPackages(root: string): Promise<WorkspacePkg[]> {
	const projects = await expandGlobDirs(root, "external");
	const dirs = (
		await Promise.all(
			projects.flatMap(async (project) => [
				project,
				...(await expandGlobDirs(project, "packages")),
			]),
		)
	).flat();
	const pkgs = await Promise.all(dirs.map((dir) => loadPackage(dir)));
	return pkgs.filter((pkg): pkg is WorkspacePkg => pkg !== null);
}

/** 单个包跳过的原因（planPublish 产出）。 */
export interface SkippedPkg {
	/** 被跳过的包。 */
	pkg: WorkspacePkg;
	/** 跳过原因（如 "版本 0.0.1 已在 registry"）。 */
	reason: string;
}

/** planPublish 的发布计划。 */
export interface PublishPlan {
	/** 需要发布的包（保持入参顺序）。 */
	toPublish: WorkspacePkg[];
	/** 已存在于 registry、无需发布的包。 */
	skipped: SkippedPkg[];
}

/**
 * 计算需要发布的包：本地版本不在 registry 已发布版本集合中 → 发布；
 * 否则跳过。registry 首次发布（404 → 空集）→ 全部发布。
 *
 * @param pkgs 工作区全部可发布包
 * @param published 包名 → 该包在 registry 的所有已发布版本集合
 */
export function planPublish(
	pkgs: readonly WorkspacePkg[],
	published: ReadonlyMap<string, ReadonlySet<string>>,
): PublishPlan {
	const toPublish: WorkspacePkg[] = [];
	const skipped: SkippedPkg[] = [];
	for (const pkg of pkgs) {
		const versions = published.get(pkg.name);
		if (versions === undefined) {
			throw new Error(
				`缺少 ${pkg.name} 的 registry 版本信息（发布前必须查询）`,
			);
		}
		if (versions.has(pkg.version)) {
			skipped.push({ pkg, reason: `版本 ${pkg.version} 已在 registry` });
		} else {
			toPublish.push(pkg);
		}
	}
	return { toPublish, skipped };
}

/**
 * 按内部依赖拓扑排序：被依赖者在前。依赖方向取自 dependencies 中出现的
 * 工作区内包名（跨仓库依赖，如 monorepo 子包依赖另一个项目的包）。
 * 存在环 → 抛错。
 */
export function topoSort(pkgs: readonly WorkspacePkg[]): WorkspacePkg[] {
	const byName = new Map(pkgs.map((pkg) => [pkg.name, pkg]));
	// 入度 = 依赖的内部包数量
	const inDegree = new Map<string, number>();
	const dependents = new Map<string, string[]>();
	for (const pkg of pkgs) {
		const internalDeps = Object.keys(pkg.dependencies).filter((name) =>
			byName.has(name),
		);
		inDegree.set(pkg.name, internalDeps.length);
		for (const dep of internalDeps) {
			const list = dependents.get(dep) ?? [];
			list.push(pkg.name);
			dependents.set(dep, list);
		}
	}
	const queue = pkgs
		.filter((pkg) => (inDegree.get(pkg.name) ?? 0) === 0)
		.map((pkg) => pkg.name);
	const ordered: string[] = [];
	while (queue.length > 0) {
		const name = queue.shift();
		if (name === undefined) {
			break;
		}
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
		throw new Error(`内部依赖存在环，无法确定发布顺序: ${cyclic.join(", ")}`);
	}
	return ordered.map((name) => byName.get(name) as WorkspacePkg);
}

/**
 * 解析 "1.2.3" 形式版本为 [major, minor, patch] 数值（非数字段按 0 处理，
 * 预发布后缀忽略——本工作区包均为纯三段版本）。
 */
function parseVersionParts(version: string): [number, number, number] {
	const parts = version.split(/[.+-]/, 3);
	return [
		Number.parseInt(parts[0] ?? "0", 10) || 0,
		Number.parseInt(parts[1] ?? "0", 10) || 0,
		Number.parseInt(parts[2] ?? "0", 10) || 0,
	];
}

/**
 * 本地版本是否低于 registry 已发布的某一版本（本地源码落后于已发布版本）。
 * 此时 npm 会拒绝隐式 latest tag（"previously published version is higher"），
 * 与其让发布链在 publish 时失败中断，不如发布前识别并跳过、明确警告。
 */
export function isDowngrade(
	local: string,
	published: ReadonlySet<string>,
): boolean {
	const localParts = parseVersionParts(local);
	for (const version of published) {
		const parts = parseVersionParts(version);
		if (
			parts[0] > localParts[0] ||
			(parts[0] === localParts[0] && parts[1] > localParts[1]) ||
			(parts[0] === localParts[0] &&
				parts[1] === localParts[1] &&
				parts[2] > localParts[2])
		) {
			return true;
		}
	}
	return false;
}

/** package.json 中可含 workspace:* 依赖的字段（发布时必须全部改写）。 */
const WORKSPACE_DEP_FIELDS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
] as const;

/** 单个依赖改写记录。 */
export interface WorkspaceRewrite {
	/** 所在字段（dependencies 等）。 */
	field: string;
	/** 依赖包名。 */
	dep: string;
	/** 改写后的版本范围（caret）。 */
	range: string;
}

/**
 * 把 package.json 文本中所有 `workspace:*` 依赖改写为 caret 真实版本
 * （npm 不认 workspace 协议，发布前必须改写；`changeset version` 正常跑时
 * 已改写，此处幂等兜底，杜绝 published 包泄漏 workspace:*）。
 *
 * 返回改写后的 JSON 文本与改写记录；无 workspace:* 时原样返回（不改写不重排）。
 * 工作区内找不到对应包版本 → 抛错（无法生成真实范围，发布链中断）。
 *
 * 改写后另有终局断言：依赖字段不得残留任何本地协议（workspace:/file:/
 * link:，含 workspace:^ 等非 * 形态——上方循环对它们是静默跳过的，全靠
 * 这道断言兜底）。2026-08-31 事故教训：绕过改写链的发布会把 workspace:*
 * 带上 npm，下游 install 直接炸。
 */
export function rewriteWorkspaceProtocol(
	raw: string,
	workspaceVersions: ReadonlyMap<string, string>,
): { text: string; changes: WorkspaceRewrite[] } {
	const pkg = JSON.parse(raw) as Record<string, unknown>;
	const changes: WorkspaceRewrite[] = [];
	for (const field of WORKSPACE_DEP_FIELDS) {
		const deps = pkg[field];
		if (typeof deps !== "object" || deps === null) {
			continue;
		}
		for (const [dep, range] of Object.entries(
			deps as Record<string, unknown>,
		)) {
			if (range !== "workspace:*") {
				continue;
			}
			const version = workspaceVersions.get(dep);
			if (version === undefined) {
				throw new Error(
					`依赖 ${dep} 声明为 workspace:*，但工作区内找不到该包版本（无法改写为真实版本号）`,
				);
			}
			(deps as Record<string, string>)[dep] = `^${version}`;
			changes.push({ field, dep, range: `^${version}` });
		}
	}
	for (const field of WORKSPACE_DEP_FIELDS) {
		const deps = pkg[field];
		if (typeof deps !== "object" || deps === null) {
			continue;
		}
		for (const [dep, range] of Object.entries(
			deps as Record<string, unknown>,
		)) {
			if (typeof range === "string" && /^(workspace|file|link):/.test(range)) {
				throw new Error(
					`${field}.${dep} 改写后仍残留本地协议 ${range}，拒绝发布`,
				);
			}
		}
	}
	const text = changes.length > 0 ? `${JSON.stringify(pkg, null, 4)}\n` : raw;
	return { text, changes };
}
