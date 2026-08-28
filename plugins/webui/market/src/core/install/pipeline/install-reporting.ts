/**
 * @file 安装日志与快照上报(core/install/pipeline 域)。
 *
 * 职责:安装开始时启动 InstallLogStore 会话并输出请求摘要(含临时
 * registry 提示);环境快照记录的"安全包装"(失败吞掉只告警,不阻断安装
 * 主流程)。被 install-executor 与 install-reload 消费。
 */
import type { Dict } from "@koishi-ce/koishi";
import type { Dependency } from "../../deps/types.js";
import type { EnvironmentSnapshotSource } from "../../environment/snapshot.js";
import type { InstallLogStore } from "../logs/store.js";
import type { PackageManifestSnapshot } from "../sources/manifest-restore.js";
import type { InstallLogger, InstallOptions } from "../types.js";
import {
	type createInstallHistoryChanges,
	formatDeps,
	formatLocalDeps,
} from "./planner.js";

/** 日志/快照上报所需的执行器依赖面（InstallExecutorDeps 的结构性子集）。 */
export interface InstallReportingDeps {
	log: InstallLogger;
	logs: InstallLogStore;
	recordEnvironmentSnapshot: (
		source: EnvironmentSnapshotSource,
		operationId?: string,
	) => Promise<unknown>;
}

/** 记录环境快照并吞掉失败（安装前后两处共用；失败只记日志不中断流程）。 */
export async function recordSnapshotSafely(
	deps: InstallReportingDeps,
	kind: "external" | "operation",
	operationId?: string,
) {
	// 快照只是回滚保险,失败不应让安装本身失败
	await deps.recordEnvironmentSnapshot(kind, operationId).catch((error) => {
		deps.log.warn(
			`failed to record ${kind === "operation" ? "dependency" : "pre-operation"} environment snapshot: ${error instanceof Error ? error.message : error}`,
		);
	});
}

/**
 * 开始安装日志并校验快照有效。
 * 日志会话启动失败只告警(日志是旁路),但 package.json 快照失败必须抛错 ——
 * 没有快照就无法回滚,不允许继续。
 */
export async function beginInstallLog(
	deps: InstallReportingDeps,
	deps2: Dict<string>,
	forced: boolean | undefined,
	options: InstallOptions,
	changes: ReturnType<typeof createInstallHistoryChanges>,
	localDeps: Dict<Dependency>,
	snapshot: PackageManifestSnapshot | undefined,
	snapshotError: unknown,
): Promise<PackageManifestSnapshot> {
	await deps.logs.start(deps2, forced, options, changes).catch((error) => {
		deps.log.warn(
			`failed to start dependency install log: ${error instanceof Error ? error.message : error}`,
		);
	});
	deps.log.info(
		`dependency install requested: deps=${formatDeps(deps2)}, forced=${!!forced}, installEndpoint=${options.installEndpoint || "(default)"}`,
	);
	deps.logs.emit(
		"stdout",
		`dependency install requested: ${formatDeps(deps2) || "(none)"}`,
	);
	if (options.installEndpoint) {
		deps.logs.emit(
			"stdout",
			`using temporary npm registry: ${options.installEndpoint}`,
		);
	}
	// 快照阶段捕获的异常推迟到这里抛:保证"请求已入日志"先于报错
	if (snapshotError) throw snapshotError;
	if (!snapshot)
		throw new Error(
			"failed to snapshot package.json before dependency operation",
		);
	deps.log.debug(
		`dependency install local state: ${formatLocalDeps(localDeps)}`,
	);
	return snapshot;
}
