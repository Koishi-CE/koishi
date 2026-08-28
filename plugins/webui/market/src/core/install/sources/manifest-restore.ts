/**
 * @file package.json 清单快照/覆盖/回滚(core/install/sources 域)。
 *
 * 职责:安装前快照宿主 package.json(保留原始文本以便整体恢复)、把目标
 * 依赖合并进 manifest(排序保证写出稳定)、安装失败时把指定依赖回滚到
 * 快照值,以及解析目标请求的本地依赖状态(旧 _getLocalDeps)。
 *
 * 架构位置:被 install/pipeline(executor 的快照/覆盖/回滚三阶段)与
 * upload/orchestrator(环境快照采集)消费;只做本地文件 I/O。
 */
import { promises as fsp } from "node:fs";
import { resolve } from "node:path";
import type { PackageJson } from "@koishi-ce/registry";
import type { Dict } from "@koishi-ce/koishi";
import { classifyDependencySource } from "../../../shared/dependency-source.js";
import type { Dependency } from "../../deps/types.js";
import { loadManifest } from "../../registry/manifest.js";
import { formatDeps } from "../pipeline/planner.js";
import type { InstallLogger } from "../types.js";

/** package.json 的安装用快照:manifest 对象、原始文本与依赖表副本。 */
export interface PackageManifestSnapshot {
	/** 解析后的 package.json(dependencies 保证存在) */
	manifest: PackageJson;
	/** 文件原始文本(当前文件损坏时兜底恢复用) */
	content: string;
	/** 安装前依赖表的浅副本(回滚时按 key 恢复) */
	dependencies: Dict<string>;
}

/** 读取并快照 package.json（含原始内容，供回滚）。 */
export async function snapshotPackageManifest(
	cwd: string,
): Promise<PackageManifestSnapshot> {
	const filename = resolve(cwd, "package.json");
	const content = await fsp.readFile(filename, "utf8");
	const manifest: PackageJson = JSON.parse(content);
	manifest.dependencies ||= {};
	return { manifest, content, dependencies: { ...manifest.dependencies } };
}

/** 把请求变化合并进 manifest.dependencies（null/'' 为删除），并按键排序。 */
export function overrideDependencies(
	manifest: PackageJson,
	deps: Dict<string>,
) {
	manifest.dependencies ||= {};
	for (const key in deps) {
		if (deps[key]) manifest.dependencies[key] = deps[key];
		else delete manifest.dependencies[key];
	}
	// 排序写出:避免依赖插入顺序不同导致 package.json 无谓 diff
	manifest.dependencies = Object.fromEntries(
		Object.entries(manifest.dependencies).sort((a, b) =>
			a[0].localeCompare(b[0]),
		),
	);
}

/** 以 2 空格缩进 + 末尾换行写出 package.json(npm 标准格式)。 */
export async function writeManifest(cwd: string, manifest: PackageJson) {
	const filename = resolve(cwd, "package.json");
	await fsp.writeFile(filename, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** 安装失败时按快照回滚指定请求，返回回滚后的 manifest。 */
export async function restorePackageManifest(
	cwd: string,
	snapshot: PackageManifestSnapshot,
	deps: Dict<string>,
	reason: string,
	log: InstallLogger,
): Promise<PackageJson> {
	const filename = resolve(cwd, "package.json");
	let manifest: PackageJson;
	try {
		manifest = JSON.parse(await fsp.readFile(filename, "utf8"));
	} catch {
		// 当前 package.json 已损坏(如安装中途被写坏):从快照原始文本整体恢复
		manifest = JSON.parse(snapshot.content);
	}
	manifest.dependencies ||= {};
	// 只回滚本次动过的 key:快照里有的恢复原值,没有的(新增依赖)删除
	for (const key of Object.keys(deps)) {
		if (Object.hasOwn(snapshot.dependencies, key)) {
			manifest.dependencies[key] = snapshot.dependencies[key]!;
		} else {
			delete manifest.dependencies[key];
		}
	}
	manifest.dependencies = Object.fromEntries(
		Object.entries(manifest.dependencies).sort((a, b) =>
			a[0].localeCompare(b[0]),
		),
	);
	await writeManifest(cwd, manifest);
	log.warn(
		`package dependencies rolled back: reason=${reason}, changes=${formatDeps(deps)}, total=${Object.keys(manifest.dependencies ?? {}).length}`,
	);
	return manifest;
}

/** 解析即将写入的请求对应的本地包状态（旧 _getLocalDeps）。 */
export function resolveLocalDeps(
	override: Dict<string>,
	cwd: string,
): Dict<Dependency> {
	const result: Dict<Dependency> = {};
	for (const [name, request] of Object.entries(override)) {
		const dep: Dependency = { request };
		try {
			const meta = loadManifest(name, cwd);
			dep.resolved = meta.version;
			dep.workspace = meta.$workspace;
		} catch {
			// 尚未安装：留空，由 classifyDependencySource 归类
		}
		Object.assign(
			dep,
			classifyDependencySource(request, {
				workspace: dep.workspace,
				installed: !!dep.resolved,
			}),
		);
		result[name] = dep;
	}
	return result;
}
