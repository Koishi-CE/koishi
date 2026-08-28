/**
 * @file 安装三阶段流程(core/install/pipeline 域):自 InstallExecutor 拆出的
 * 私有流程方法,成块移植、逻辑与行为未改。
 *
 * 阶段划分:
 * - prepare:快照 package.json → 本地依赖解析 → 历史变化 → 开始日志
 *   (含快照有效性校验);
 * - apply:本地来源补齐(按需)→ 覆盖 package.json;
 * - package-manager/finalize:运行包管理器(失败则回滚清单)与成功收尾
 *   (依赖状态重置 → 整帧重载判定 → 前置钩子 → 环境快照与日志)。
 *
 * 架构位置:全部 I/O 经 deps(InstallExecutorDeps)注入,由 install-executor
 * 的 runInstallLocked 在串行锁内按序调用。
 */
import { resolve } from "node:path";
import type { Dict } from "@koishi-ce/koishi";
import type { PackageJson } from "@koishi-ce/registry";
import type { Dependency } from "../../deps/types.js";
import { resolveLocalSources } from "../sources/local-sources.js";
import {
	overrideDependencies,
	type PackageManifestSnapshot,
	resolveLocalDeps,
	restorePackageManifest,
	snapshotPackageManifest,
	writeManifest,
} from "../sources/manifest-restore.js";
import type { InstallOptions } from "../types.js";
import type { InstallExecutorDeps } from "./install-executor.js";
import { detectFullReload, finalizeInstall } from "./install-reload.js";
import { beginInstallLog, recordSnapshotSafely } from "./install-reporting.js";
import {
	createInstallHistoryChanges,
	formatDeps,
	requiresPackageManager,
} from "./planner.js";
import { runPackageManager } from "./runner.js";

/** 运行包管理器；失败时回滚清单并返回退出码。 */
export async function runPackageManagerPhase(
	deps: InstallExecutorDeps,
	deps2: Dict<string>,
	snapshot: PackageManifestSnapshot,
	options: InstallOptions,
): Promise<number | undefined> {
	deps.logs.emit("stdout", "running package manager install…");
	const code = await installWithRegistry(deps, options);
	// code 为 0(falsy)时走到 undefined 返回值,表示"包管理器阶段成功"
	if (!code) return;
	// 非零退出:把 package.json 回滚到安装前快照,并重建依赖状态,原样返回退出码
	await restorePackageManifest(
		deps.cwd,
		snapshot,
		deps2,
		`package manager exited with code ${code}`,
		deps.log,
	);
	await deps.resolver.reload();
	await deps.refreshChannels();
	return code;
}

/** 安装前准备：快照 → 本地依赖解析 → 历史变化 → 开始日志（含快照有效性校验）。 */
async function prepareInstallRun(
	deps: InstallExecutorDeps,
	deps2: Dict<string>,
	forced: boolean | undefined,
	options: InstallOptions,
): Promise<{ snapshot: PackageManifestSnapshot; localDeps: Dict<Dependency> }> {
	let snapshot: PackageManifestSnapshot | undefined;
	let snapshotError: unknown;
	try {
		snapshot = await snapshotPackageManifest(deps.cwd);
	} catch (error) {
		// 快照失败不在此时抛:先让 beginInstallLog 记录请求日志,再由它统一抛出
		snapshotError = error;
	}
	const localDeps = resolveLocalDeps(deps2, deps.cwd);
	const changes = snapshot
		? createInstallHistoryChanges(snapshot.dependencies, deps2, localDeps)
		: [];
	await recordSnapshotSafely(deps, "external");
	const validated = await beginInstallLog(
		deps,
		deps2,
		forced,
		options,
		changes,
		localDeps,
		snapshot,
		snapshotError,
	);
	return { snapshot: validated, localDeps };
}

/** 安装成功收尾：刷新依赖状态 → 重载判定 → 前置钩子 → 环境快照与整帧重载。 */
export async function finalizeSuccessRun(
	deps: InstallExecutorDeps,
	deps2: Dict<string>,
	localDeps: Dict<Dependency>,
	snapshot: PackageManifestSnapshot,
	beforeReload: (() => unknown | Promise<unknown>) | undefined,
	needsPackageManager: boolean,
	start: number,
) {
	await refreshDependencyState(deps);
	// 重置后取新鲜依赖缓存,用于判定本地依赖版本是否真的发生了变化
	const newDeps = deps.resolver.getDeps({
		background: false,
	}) as Dict<Dependency>;
	const shouldReload = detectFullReload(
		deps,
		localDeps,
		newDeps,
		snapshot.dependencies,
		deps2,
	);
	if (beforeReload) {
		deps.log.debug("run pre-reload dependency hook");
		await beforeReload();
	}
	await deps.refreshChannels();
	await finalizeInstall(deps, deps2, needsPackageManager, shouldReload, start);
}

/** 来源校验 + 清单覆盖（跑包管理器前的准备阶段）。 */
export async function prepareAndApplyChanges(
	deps: InstallExecutorDeps,
	deps2: Dict<string>,
	forced: boolean | undefined,
	options: InstallOptions,
	depCache: Dict<Dependency>,
): Promise<{
	snapshot: PackageManifestSnapshot;
	localDeps: Dict<Dependency>;
	needsPackageManager: boolean;
}> {
	const { snapshot, localDeps } = await prepareInstallRun(
		deps,
		deps2,
		forced,
		options,
	);
	const needsPackageManager = requiresPackageManager(
		deps2,
		localDeps,
		snapshot.dependencies,
		depCache,
		forced,
	);
	if (needsPackageManager) {
		// 本地来源(file:/workspace)需要先补齐/校验,才能交给包管理器解析
		await resolveLocalSources(deps, depCache, deps2);
	}
	await applyOverride(deps, snapshot.manifest, deps2);
	deps.logs.emit(
		"stdout",
		"package.json dependencies updated, preparing package manager workflow…",
	);
	return { snapshot, localDeps, needsPackageManager };
}

/** 把目标依赖覆盖写进 package.json(空串请求 = 删除该依赖)。 */
async function applyOverride(
	deps: InstallExecutorDeps,
	manifest: PackageJson,
	deps2: Dict<string>,
) {
	const filename = resolve(deps.cwd, "package.json");
	deps.log.debug(
		`override package dependencies: file=${filename}, changes=${formatDeps(deps2)}`,
	);
	overrideDependencies(manifest, deps2);
	await writeManifest(deps.cwd, manifest);
	deps.log.info(
		`package dependencies updated: changes=${formatDeps(deps2)}, total=${Object.keys(manifest.dependencies ?? {}).length}`,
	);
}

/** 计算并运行包管理器:优先本次安装的临时 endpoint,其次配置指定的 registry。 */
function installWithRegistry(
	deps: InstallExecutorDeps,
	options: InstallOptions,
) {
	options ||= {};
	const args: string[] = [];
	const endpoint =
		options.installEndpoint ||
		(deps.config.endpoint ? deps.registry.endpoint : "");
	if (endpoint) args.push("--registry", endpoint);
	return runPackageManager(args, {
		cwd: deps.cwd,
		agent: deps.agent,
		log: deps.log,
		emitLog: (type, line) => deps.logs.emit(type, line),
	});
}

/** 安装前的依赖状态全量重置（旧 refresh() 主流程）。 */
export async function refreshDependencyState(deps: InstallExecutorDeps) {
	// 先推进竞速失效域:让此前发出的旧 registry 请求全部作废
	deps.scope.advance("dependency refresh superseded");
	await deps.registry.resetEndpoint();
	deps.clearRegistryStatus();
	deps.resolver.resetForRefresh();
}
