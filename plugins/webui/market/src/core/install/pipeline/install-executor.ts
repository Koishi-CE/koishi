/**
 * @file 安装执行器(core/install/pipeline 域):installLocked 的流程骨架。
 *
 * 完整流程:依赖缓存取数 → 快照 package.json → 本地依赖解析 → 是否需要
 * 包管理器判定 → 本地来源补齐 → 覆盖 package.json → 运行包管理器
 * (失败则回滚清单)→ 依赖状态重置 → 整帧重载判定 → 收尾(环境快照/日志)。
 *
 * 关键设计:
 * - 包管理器非零退出不抛异常而是返回退出码,同时回滚 package.json 到快照;
 * - 失败路径统一在 runInstallLocked 的 catch/finally 收口:
 *   异常上抛但安装日志(logs.finish)必定定稿;
 * - 环境快照经由编排器注入的 recordEnvironmentSnapshot 记录,
 *   "external"(操作前)与"operation"(操作后)各一次。
 *
 * 架构位置:自旧 InstallOrchestrator 拆出,由编排器在串行锁内调用;
 * 成块移植自旧 Installer 的 _installLocked,流程未改。
 * prepare/apply/package-manager/finalize 各阶段的实现出仓至 install-phases.ts。
 */
import type { Dict } from "@koishi-ce/koishi";
import type { Dependency } from "../../deps/types.js";
import type { EnvironmentSnapshot, EnvironmentSnapshotSource } from "../../environment/snapshot.js";
import type { InstallOptions, InstallOrchestratorDeps } from "../types.js";
import {
    finalizeSuccessRun,
    prepareAndApplyChanges,
    refreshDependencyState,
    runPackageManagerPhase,
} from "./install-phases.js";

/** 安装执行器依赖面：宿主 deps + 环境快照记录回调（由 InstallOrchestrator 提供）。 */
export interface InstallExecutorDeps extends InstallOrchestratorDeps {
    recordEnvironmentSnapshot: (
        source: EnvironmentSnapshotSource,
        operationId?: string,
    ) => Promise<EnvironmentSnapshot>;
}

/** 安装执行器：串行锁内快照 → 来源校验 → 包管理器 → 回滚/刷新/重载（自 InstallOrchestrator 拆出）。 */
export class InstallExecutor {
    private readonly deps: InstallExecutorDeps;

    constructor(deps: InstallExecutorDeps) {
        this.deps = deps;
    }

    /** 安装主流程（旧 _installLocked）：快照 → 来源校验 → 包管理器 → 回滚/刷新/重载。 */
    async installLocked(
        deps: Dict<string>,
        forced?: boolean,
        beforeReload?: () => unknown | Promise<unknown>,
        options: InstallOptions = {},
    ): Promise<number> {
        options ||= {};
        const start = Date.now();
        // 先取一份不加后台刷新的依赖缓存:后面 requiresPackageManager 判定以它为基准
        const depCache = this.deps.resolver.getDeps({ background: false }) as Dict<Dependency>;
        return this.runInstallLocked(deps, forced, beforeReload, options, start, depCache);
    }

    /**
     * 锁内安装的顶层流程:准备并覆盖清单 → (按需)跑包管理器 → 成功收尾;
     * 包管理器非零退出码直接返回,异常上抛;finally 里无论如何都定稿安装日志。
     */
    private async runInstallLocked(
        deps: Dict<string>,
        forced: boolean | undefined,
        beforeReload: (() => unknown | Promise<unknown>) | undefined,
        options: InstallOptions,
        start: number,
        depCache: Dict<Dependency>,
    ): Promise<number> {
        let resultCode: number | undefined;
        let logResult: { code?: number | null; failed?: boolean; reason?: string } | undefined;
        try {
            const { snapshot, localDeps, needsPackageManager } = await prepareAndApplyChanges(
                this.deps,
                deps,
                forced,
                options,
                depCache,
            );

            if (needsPackageManager) {
                const code = await runPackageManagerPhase(this.deps, deps, snapshot, options);
                if (code !== undefined) {
                    // 非零退出:清单已回滚,直接把退出码交还调用方,不进成功收尾
                    resultCode = code;
                    logResult = { code };
                    return code;
                }
            }

            await finalizeSuccessRun(
                this.deps,
                deps,
                localDeps,
                snapshot,
                beforeReload,
                needsPackageManager,
                start,
            );
            resultCode = 0;
            logResult = { code: 0 };
            return 0;
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            logResult = { code: resultCode ?? null, failed: true, reason };
            this.deps.logs.emit("stderr", `dependency operation failed: ${reason}`);
            throw error;
        } finally {
            // 日志定稿失败只告警:不能让收尾失败掩盖安装本身的结果
            await this.deps.logs.finish(logResult).catch((error) => {
                this.deps.log.warn(
                    `failed to finish dependency install log: ${error instanceof Error ? error.message : error}`,
                );
            });
        }
    }

    /** 安装前的依赖状态全量重置（旧 refresh() 主流程；实现出仓至 install-phases）。 */
    async refreshDependencyState() {
        await refreshDependencyState(this.deps);
    }
}
