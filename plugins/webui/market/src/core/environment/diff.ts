/**
 * @file 环境快照差异计算(core/environment 域)。
 *
 * getEnvironmentDiff 对比当前环境与目标快照,逐依赖给出变更状态
 * (upgrade/downgrade/added/removed/changed/unchanged/unsupported,
 * 本地来源依赖标记 unsupported —— 回滚不处理本地包);
 * getEnvironmentInstallChanges 把 diff 折叠成可交给包管理器的请求
 * 变化表。纯函数,被 install/environment(回滚预览与执行)消费。
 */
import type { Dict } from "@koishi-ce/koishi";
import { compare, valid } from "semver";
import type { EnvironmentDependencySnapshot, EnvironmentSnapshot } from "./snapshot.js";

/** 依赖在两份快照间的变更状态。 */
export type EnvironmentChangeStatus =
    | "upgrade"
    | "downgrade"
    | "added"
    | "removed"
    | "changed"
    | "unchanged"
    | "unsupported";

/** 单个依赖的差异明细(前端回滚预览列表的条目)。 */
export interface EnvironmentSnapshotChange {
    name: string;
    /** 当前环境的请求串 */
    currentRequest?: string | undefined;
    /** 当前环境的展示版本(resolved 优先,否则请求串) */
    currentVersion?: string | undefined;
    /** 目标快照的请求串 */
    targetRequest?: string | undefined;
    /** 目标快照的展示版本 */
    targetVersion?: string | undefined;
    status: EnvironmentChangeStatus;
    /** unsupported 的原因(目前只有 local) */
    reason?: "local" | undefined;
}

/** 回滚到某快照的预览(摘要 + 差异列表 + 统计)。 */
export interface EnvironmentSnapshotPreview {
    snapshot: import("./snapshot.js").EnvironmentSnapshotSummary;
    changes: EnvironmentSnapshotChange[];
    /** 可执行(非 unchanged/unsupported)的变化数 */
    actionableCount: number;
    /** 本地来源等不支持回滚的变化数 */
    unsupportedCount: number;
}

/**
 * 判定两侧依赖是否"等价":本地来源按请求串 + 来源分类比较;
 * registry 依赖按已装版本(缺省回退请求串)比较。
 */
function sameDependency(
    left?: EnvironmentDependencySnapshot,
    right?: EnvironmentDependencySnapshot,
) {
    if (!left || !right) return false;
    if (left.local || right.local) {
        return (
            left.request === right.request &&
            left.source === right.source &&
            !!left.local === !!right.local
        );
    }
    return (left.resolved || left.request) === (right.resolved || right.request);
}

/** 展示用版本:已装版本优先,未装时退回请求串。 */
function displayVersion(dependency?: EnvironmentDependencySnapshot) {
    return dependency?.resolved || dependency?.request;
}

/** 当前环境与目标快照的逐依赖差异（按名排序）。 */
export function getEnvironmentDiff(current: EnvironmentSnapshot, target: EnvironmentSnapshot) {
    const names = new Set([
        ...Object.keys(current.dependencies),
        ...Object.keys(target.dependencies),
    ]);
    return [...names]
        .sort((a, b) => a.localeCompare(b))
        .map((name): EnvironmentSnapshotChange => {
            const currentDependency = current.dependencies[name];
            const targetDependency = target.dependencies[name];
            const base = {
                name,
                currentRequest: currentDependency?.request,
                currentVersion: displayVersion(currentDependency),
                targetRequest: targetDependency?.request,
                targetVersion: displayVersion(targetDependency),
            };

            if (sameDependency(currentDependency, targetDependency)) {
                return { ...base, status: "unchanged" };
            }

            // 本地来源(workspace/file:)的增删换不走包管理器回滚,单独标记
            if (currentDependency?.local || targetDependency?.local) {
                return { ...base, status: "unsupported", reason: "local" };
            }

            if (!currentDependency) return { ...base, status: "added" };
            if (!targetDependency) return { ...base, status: "removed" };

            const currentVersion = currentDependency.resolved;
            const targetVersion = targetDependency.resolved;
            // 双方都是合法 semver 才细分升降级,否则只能笼统记 changed
            if (currentVersion && targetVersion && valid(currentVersion) && valid(targetVersion)) {
                const direction = compare(targetVersion, currentVersion);
                if (direction > 0) return { ...base, status: "upgrade" };
                if (direction < 0) return { ...base, status: "downgrade" };
            }
            return { ...base, status: "changed" };
        });
}

/**
 * 由 diff 推导出要交给包管理器执行的请求变化。
 * unchanged/unsupported 跳过;目标有该依赖则取其已装版本(缺省取请求串),
 * 目标没有则空串(表示移除)。产出直接进安装流水线的 deps 表。
 */
export function getEnvironmentInstallChanges(
    diff: EnvironmentSnapshotChange[],
    target: EnvironmentSnapshot,
) {
    const changes: Dict<string> = {};
    for (const change of diff) {
        if (change.status === "unchanged") continue;
        if (change.status === "unsupported") continue;
        const dependency = target.dependencies[change.name];
        changes[change.name] = dependency ? dependency.resolved || dependency.request : "";
    }
    return changes;
}
