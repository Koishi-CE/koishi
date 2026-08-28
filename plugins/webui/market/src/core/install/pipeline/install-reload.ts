/**
 * @file 整帧重载判定与安装收尾(core/install/pipeline 域)。
 *
 * 职责:detectFullReload 判定本地依赖变更后是否需要重启整个 Koishi 进程
 * (已被 require 加载的本地包热替换不可靠);finalizeInstall 负责成功后的
 * 环境快照、完成日志与延迟触发的整帧重载。
 *
 * 关键设计:重载延迟 1 秒执行,给日志/配置写回留出落盘窗口;
 * 触发时再次校验 isActive(),宿主已停用则放弃重载。
 */
import type { Dict } from "@koishi-ce/koishi";
import { classifyDependencySource } from "../../../shared/dependency-source.js";
import type { Dependency } from "../../deps/types.js";
import { SECOND } from "../../utils/time.js";
import {
	type InstallReportingDeps,
	recordSnapshotSafely,
} from "./install-reporting.js";
import { formatDeps } from "./planner.js";

/** 整帧重载的延迟窗口:让日志定稿与配置写回先完成。 */
const FULL_RELOAD_DELAY = SECOND;

/** reload 判定与安装收尾所需的执行器依赖面（InstallExecutorDeps 的结构性子集）。 */
export interface InstallFinalizerDeps extends InstallReportingDeps {
	/** require.resolve(name) in require.cache 的等价判定（含解析失败 → true） */
	isPackageLoaded: (name: string) => boolean;
	isActive: () => boolean;
	fullReload: () => void;
}

/** 本地依赖安装后是否需要整帧重载（旧 _installLocked 的 reload 判定循环）。 */
export function detectFullReload(
	deps: InstallFinalizerDeps,
	localDeps: Dict<Dependency>,
	newDeps: Dict<Dependency>,
	previousRequests: Dict<string>,
	requests: Dict<string>,
) {
	let shouldReload = false;
	for (const name in localDeps) {
		if (
			isReloadRequired(
				deps,
				name,
				localDeps[name],
				newDeps[name],
				previousRequests,
				requests,
			)
		) {
			shouldReload = true;
		}
	}
	return shouldReload;
}

/** 判定单个本地依赖是否触发整帧重载（detectFullReload 循环体提炼）；发生变化时记录调试日志。 */
function isReloadRequired(
	deps: InstallFinalizerDeps,
	name: string,
	previous: Dependency | undefined,
	current: Dependency | undefined,
	previousRequests: Dict<string>,
	requests: Dict<string>,
): boolean {
	// 只关心仍在依赖表里的本地包:已被移除的没有"换版本"可言
	if (!current) return false;
	const changed = hasLocalDependencyChanged(
		name,
		previous?.resolved,
		current,
		previousRequests,
		requests,
	);
	if (!changed) return false;
	deps.log.debug(
		`dependency changed may require full reload: ${name}, previous=${previous?.resolved ?? "-"}, current=${current?.resolved ?? "-"}`,
	);
	// 只有"已被 require 缓存"的包才必须重启:未加载的包下次加载自然是新版本
	return deps.isPackageLoaded(name);
}

/**
 * 判定单个本地依赖是否发生变化:已装版本不同即变;版本相同但请求串变了,
 * 且新请求仍归类为本地来源(workspace/file:),也视为发生了"换绑"变化。
 */
function hasLocalDependencyChanged(
	name: string,
	previousResolved: string | undefined,
	current: Dependency,
	previousRequests: Dict<string>,
	requests: Dict<string>,
) {
	if (current.resolved !== previousResolved) return true;
	if (previousRequests[name] === requests[name]) return false;
	return classifyDependencySource(requests[name] ?? "", {
		workspace: current.workspace,
		installed: !!current.resolved,
	}).local;
}

/** 安装成功后的收尾：环境快照、完成日志与按需整帧重载。 */
export async function finalizeInstall(
	deps: InstallFinalizerDeps,
	requests: Dict<string>,
	needsPackageManager: boolean,
	shouldReload: boolean,
	start: number,
) {
	// "operation" 快照挂在本次安装日志的 id 下,回滚时可按图索骥
	await recordSnapshotSafely(deps, "operation", deps.logs.activeMetadata?.id);
	deps.log.info(
		`dependency install completed: deps=${formatDeps(requests)}, forced=${!!needsPackageManager}, fullReload=${shouldReload}, elapsed=${Date.now() - start}ms`,
	);
	if (shouldReload) {
		deps.logs.emit("stdout", `full reload scheduled in ${FULL_RELOAD_DELAY}ms`);
		deps.log.info(
			`dependency install triggers full reload after ${FULL_RELOAD_DELAY}ms`,
		);
		// 延迟重载:让安装日志/配置写回先落盘;执行时再确认宿主仍活跃
		setTimeout(() => {
			if (deps.isActive()) deps.fullReload();
		}, FULL_RELOAD_DELAY);
	}
}
