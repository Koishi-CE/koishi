/**
 * @file 安装编排器(core/install/pipeline 域):对外的安装入口门面。
 *
 * 职责:把 InstallQueue(串行锁)与 InstallExecutor(实际流程)组合起来,
 * 并承载环境快照的采集/记录(capture/record CurrentEnvironmentSnapshot)。
 * 本类不包含安装算法本体 —— 具体流程在 install-executor.ts,
 * 快照读写的持久化在 environments(EnvironmentSnapshotOps)。
 *
 * 架构位置:由 node 适配层装配,install()/refreshDependencyState() 是
 * 宿主 RPC 进入 core 安装域的入口;全部 I/O 经 InstallOrchestratorDeps 注入。
 */
import type { Dict } from "@koishi-ce/koishi";
import { buildEnvironmentDependencies } from "../../environment/apply.js";
import {
	createEnvironmentSnapshot,
	type EnvironmentSnapshot,
	type EnvironmentSnapshotSource,
} from "../../environment/snapshot.js";
import {
	resolveLocalDeps,
	snapshotPackageManifest,
} from "../sources/manifest-restore.js";
import type { InstallOptions, InstallOrchestratorDeps } from "../types.js";
import {
	InstallExecutor,
	type InstallExecutorDeps,
} from "./install-executor.js";
import { formatDeps } from "./planner.js";

/** 安装编排：串行锁 + 快照/回滚 + 包管理器执行。环境快照读写在 EnvironmentSnapshotOps。 */
export class InstallOrchestrator {
	private readonly deps: InstallOrchestratorDeps;
	private readonly executor: InstallExecutor;

	constructor(deps: InstallOrchestratorDeps) {
		this.deps = deps;
		// 执行器需要"记录环境快照"回调,而快照采集又依赖本类的 deps:
		// 在这里闭包缝合,避免执行器反向依赖编排器
		const executorDeps: InstallExecutorDeps = {
			...deps,
			recordEnvironmentSnapshot: (source, operationId) =>
				this.recordCurrentEnvironmentSnapshot(source, operationId),
		};
		this.executor = new InstallExecutor(executorDeps);
	}

	/** 是否有安装任务在执行(透传队列状态,含排队)。 */
	get isInstalling() {
		return this.deps.queue.isInstalling;
	}

	/**
	 * 安装入口:先过串行锁(同一时刻仅一个安装),锁内执行完整流程。
	 *
	 * @param deps 目标依赖表(name → 请求串;空串表示移除)
	 * @param forced 强制跑包管理器(跳过"已满足"优化)
	 * @param beforeReload 整帧重载前的前置钩子(如配置写回)
	 * @param options 安装选项(如临时 registry endpoint)
	 */
	install(
		deps: Dict<string>,
		forced?: boolean,
		beforeReload?: () => unknown | Promise<unknown>,
		options: InstallOptions = {},
	) {
		return this.deps.queue.withLock(`deps=${formatDeps(deps)}`, () =>
			this.installLocked(deps, forced, beforeReload, options),
		);
	}

	/** 安装主流程（旧 _installLocked）：快照 → 来源校验 → 包管理器 → 回滚/刷新/重载。 */
	installLocked(
		deps: Dict<string>,
		forced?: boolean,
		beforeReload?: () => unknown | Promise<unknown>,
		options: InstallOptions = {},
	) {
		return this.executor.installLocked(deps, forced, beforeReload, options);
	}

	/** 安装前的依赖状态全量重置（旧 refresh() 主流程）。 */
	async refreshDependencyState() {
		await this.executor.refreshDependencyState();
	}

	/**
	 * 采集当前环境快照:package.json 快照 + 本地依赖解析结果合成为
	 * 可回滚的环境依赖表(不落盘,由调用方决定是否 record)。
	 */
	async captureCurrentEnvironmentSnapshot(
		source: EnvironmentSnapshotSource,
		operationId?: string,
	): Promise<EnvironmentSnapshot> {
		const manifest = await snapshotPackageManifest(this.deps.cwd);
		const local = resolveLocalDeps(manifest.dependencies, this.deps.cwd);
		const dependencies = buildEnvironmentDependencies(
			manifest.dependencies,
			local,
		);
		return createEnvironmentSnapshot(dependencies, source, operationId);
	}

	/** 采集并持久化环境快照(安装前后各调一次,供 environment 域回滚)。 */
	async recordCurrentEnvironmentSnapshot(
		source: EnvironmentSnapshotSource,
		operationId?: string,
	) {
		const snapshot = await this.captureCurrentEnvironmentSnapshot(
			source,
			operationId,
		);
		await this.deps.environments.record(snapshot);
		return snapshot;
	}
}
