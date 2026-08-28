/**
 * 环境快照的对外操作入口（列表 / 预览 / 恢复）。
 *
 * 在安装域与环境快照域（core/environment）之间做编排：读取与 diff 委托给
 * EnvironmentSnapshotStore 与 getEnvironmentDiff，而「捕获当前环境」「执行安装」
 * 则复用 InstallOrchestrator 的 captureCurrentEnvironmentSnapshot 与 installLocked，
 * 避免重复实现一份安装流程。
 *
 * 位置：由 src/node 适配层作为 RPC（market/environment-* 系列）的直接后端；
 * 恢复操作与安装共用 InstallQueue 串行锁，防止与安装并发写 package.json。
 */
import { planEnvironmentApply } from "../environment/apply.js";
import { getEnvironmentDiff } from "../environment/diff.js";
import {
    type EnvironmentSnapshotStore,
    type EnvironmentSnapshotSummary,
    summarizeEnvironmentSnapshot,
} from "../environment/snapshot.js";
import type { InstallOrchestrator } from "./pipeline/orchestrator.js";
import { formatDeps } from "./pipeline/planner.js";
import type { InstallQueue } from "./pipeline/queue.js";
import type { InstallLogger, InstallOptions } from "./types.js";

/** EnvironmentSnapshotOps 的构造依赖面（编排器与快照存储的组合）。 */
export interface EnvironmentSnapshotOpsDeps {
    log: InstallLogger;
    environments: EnvironmentSnapshotStore;
    queue: InstallQueue;
    orchestrator: InstallOrchestrator;
}

/** 环境快照的读取/预览/恢复（复用 orchestrator 的 capture 与 installLocked）。 */
export class EnvironmentSnapshotOps {
    private readonly deps: EnvironmentSnapshotOpsDeps;

    constructor(deps: EnvironmentSnapshotOpsDeps) {
        this.deps = deps;
    }

    /**
     * 列出全部环境快照（附「是否即当前环境」标记）。
     * 安装进行中只捕获不落盘（capture），否则捕获并记录（record），
     * 保证返回的 current.id 总能反映此刻的依赖状态。
     */
    async getEnvironmentSnapshots(): Promise<EnvironmentSnapshotSummary[]> {
        const orchestrator = this.deps.orchestrator;
        // 安装进行中磁盘状态不稳定，改用一次性捕获而不写入快照库
        const current = orchestrator.isInstalling
            ? await orchestrator.captureCurrentEnvironmentSnapshot("external")
            : await orchestrator.recordCurrentEnvironmentSnapshot("external");
        const snapshots = await this.deps.environments.list();
        return snapshots.map((snapshot) => summarizeEnvironmentSnapshot(snapshot, current.id));
    }

    /**
     * 预览恢复到指定快照的差异：返回目标摘要、逐依赖变更与可操作/不可恢复计数。
     * 目标不存在时返回 undefined（由调用方转成用户可见错误）。
     */
    async getEnvironmentSnapshotPreview(id: string) {
        const orchestrator = this.deps.orchestrator;
        const target = await this.deps.environments.get(id);
        if (!target) return undefined;
        const current = orchestrator.isInstalling
            ? await orchestrator.captureCurrentEnvironmentSnapshot("external")
            : await orchestrator.recordCurrentEnvironmentSnapshot("external");
        const changes = getEnvironmentDiff(current, target);
        return {
            snapshot: summarizeEnvironmentSnapshot(target, current.id),
            changes,
            // 「可操作」= 除 unchanged/unsupported 外的变更数，前端据此显示恢复按钮文案
            actionableCount: changes.filter(
                (change) => !["unchanged", "unsupported"].includes(change.status),
            ).length,
            unsupportedCount: changes.filter((change) => change.status === "unsupported").length,
        };
    }

    /**
     * 恢复到指定环境快照：与安装共用串行锁；规划出请求变化后走 installLocked
     * （forced，跳过「已满足」优化）。返回安装退出码（无变化时为 0）。
     * 目标不存在 / 含不可恢复的本地依赖 / 已是目标环境时分别抛错或直接短路返回。
     */
    async applyEnvironmentSnapshot(id: string, options: InstallOptions = {}) {
        options ||= {};
        return this.deps.queue.withLock(`environmentSnapshot=${id}`, async () => {
            const target = await this.deps.environments.get(id);
            if (!target) throw new Error("目标环境版本不存在或已被清理。");
            const current =
                await this.deps.orchestrator.captureCurrentEnvironmentSnapshot("external");
            const { unsupported, changes } = planEnvironmentApply(current, target);
            if (unsupported.length) {
                throw new Error(
                    `目标环境包含无法自动恢复的本地依赖：${unsupported.map((change) => change.name).join(", ")}`,
                );
            }
            if (!Object.keys(changes).length) {
                // 当前环境与目标一致：不跑安装，仅把当前状态记录为一次「恢复」
                await this.deps.environments.record(current);
                return 0;
            }
            this.deps.log.info(
                `environment snapshot restore requested: target=${id}, changes=${formatDeps(changes)}`,
            );
            return this.deps.orchestrator.installLocked(changes, true, undefined, options);
        });
    }
}
