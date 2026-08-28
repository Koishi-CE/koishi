/**
 * @file 环境快照的形状与纯函数(core/environment 域)。
 *
 * 从 snapshot.ts 拆出:快照相关类型、依赖表归一化(normalize)、内容哈希
 * 规范文本(canonical)、快照 id 生成、快照构建(create)与摘要(summarize)。
 * 全部为无 I/O 的纯函数,持久化存储在邻文件 snapshot.ts。
 */
import { createHash } from "node:crypto";
import type { Dict } from "@koishi-ce/koishi";
import {
	classifyDependencySource,
	type DependencySource,
} from "../../shared/dependency-source.js";

/** 单个依赖在快照中的形态(请求 + 已装状态 + 来源分类)。 */
export interface EnvironmentDependencySnapshot {
	/** package.json 中的原始请求串 */
	request: string;
	/** 已装版本(未安装时缺省) */
	resolved?: string | undefined;
	/** 是否 workspace 成员 */
	workspace?: boolean | undefined;
	/** 来源分类(registry/local/unbound 等) */
	source?: DependencySource | undefined;
	/** 是否本地来源依赖 */
	local?: boolean | undefined;
	bound?: boolean | undefined;
	/** 请求是否非法(非本地且非合法 semver) */
	invalid?: boolean | undefined;
}

/** 快照来源:启动采集 / 安装操作后 / 外部变更(安装前兜底)。 */
export type EnvironmentSnapshotSource = "startup" | "operation" | "external";

/** 环境快照(依赖表的完整存档)。 */
export interface EnvironmentSnapshot {
	/** 内容哈希 id(env-<sha256 前 20 位>,内容相同即同 id) */
	id: string;
	/** 首次创建时间 */
	createdAt: number;
	/** 最近一次以同内容出现的时间(淘汰排序依据) */
	lastSeenAt?: number | undefined;
	source: EnvironmentSnapshotSource;
	/** 关联的安装日志 id(source=operation 时) */
	operationId?: string | undefined;
	dependencies: Dict<EnvironmentDependencySnapshot>;
}

/** 快照摘要(列表展示用,不含依赖明细)。 */
export interface EnvironmentSnapshotSummary {
	id: string;
	createdAt: number;
	lastSeenAt?: number | undefined;
	source: EnvironmentSnapshotSource;
	operationId?: string | undefined;
	/** 依赖条目数 */
	dependencyCount: number;
	/** 是否当前环境对应的快照 */
	current: boolean;
}

/** 快照文件的落盘结构(version 1)。 */
export interface PersistedEnvironmentSnapshotStore {
	version: 1;
	snapshots: EnvironmentSnapshot[];
}

/** 最多保留的快照条数(超出按 lastSeenAt 淘汰最旧)。 */
export const MAX_SNAPSHOTS = 60;

/** 依赖快照归一化：键排序、source 补全、可选字段去空。 */
function normalizeEnvironmentDependencies(
	dependencies: Dict<EnvironmentDependencySnapshot>,
) {
	const result: Dict<EnvironmentDependencySnapshot> = {};
	for (const name of Object.keys(dependencies).sort((a, b) =>
		a.localeCompare(b),
	)) {
		const dependency = dependencies[name];
		if (!dependency || typeof dependency.request !== "string") continue;
		const source = classifyDependencySource(dependency.request, {
			workspace: dependency.workspace,
		});
		result[name] = {
			request: dependency.request,
			resolved: dependency.resolved || undefined,
			workspace: dependency.workspace || undefined,
			// source 缺失时按请求串重新分类补全
			source: dependency.source || source.source,
			local: (dependency.local ?? source.local) || undefined,
			bound: dependency.bound,
			invalid: dependency.invalid || undefined,
		};
	}
	return result;
}

/**
 * 生成依赖表的规范化文本(用于内容哈希):只取影响语义的字段
 * (name/版本或请求/source/local),键已排序,确保内容等价的
 * 两份快照哈希一致。
 */
function canonicalDependencies(
	dependencies: Dict<EnvironmentDependencySnapshot>,
) {
	const normalized = normalizeEnvironmentDependencies(dependencies);
	return JSON.stringify(
		Object.entries(normalized).map(([name, dependency]) => [
			name,
			dependency.local
				? dependency.request
				: dependency.resolved || dependency.request,
			dependency.source || "",
			!!dependency.local,
		]),
	);
}

/** 由依赖表内容生成快照 id(env- + sha256 前 20 位)。 */
function getEnvironmentSnapshotId(
	dependencies: Dict<EnvironmentDependencySnapshot>,
) {
	return `env-${createHash("sha256")
		.update(canonicalDependencies(dependencies))
		.digest("hex")
		.slice(0, 20)}`;
}

/** 构建环境快照:归一化依赖表并生成内容哈希 id。 */
export function createEnvironmentSnapshot(
	dependencies: Dict<EnvironmentDependencySnapshot>,
	source: EnvironmentSnapshotSource,
	operationId?: string,
	now = Date.now(),
): EnvironmentSnapshot {
	const normalized = normalizeEnvironmentDependencies(dependencies);
	return {
		id: getEnvironmentSnapshotId(normalized),
		createdAt: now,
		lastSeenAt: now,
		source,
		operationId,
		dependencies: normalized,
	};
}

/** 快照 → 摘要(currentId 相同者标记为当前环境)。 */
export function summarizeEnvironmentSnapshot(
	snapshot: EnvironmentSnapshot,
	currentId?: string,
): EnvironmentSnapshotSummary {
	return {
		id: snapshot.id,
		createdAt: snapshot.createdAt,
		lastSeenAt: snapshot.lastSeenAt,
		source: snapshot.source,
		operationId: snapshot.operationId,
		dependencyCount: Object.keys(snapshot.dependencies).length,
		current: snapshot.id === currentId,
	};
}
