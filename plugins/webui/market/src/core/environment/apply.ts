/**
 * @file 环境快照的构建与回滚规划(core/environment 域)。
 *
 * buildEnvironmentDependencies 把 manifest 请求表与本地解析结果(localDeps)
 * 合成为快照依赖表;planEnvironmentApply 是应用(回滚到)某快照前的纯规划:
 * diff + 不可恢复项 + 安装请求变化,实际执行在 install/environment.ts。
 */
import type { Dict } from "@koishi-ce/koishi";
import { valid } from "semver";
import type { Dependency } from "../deps/types.js";
import { getEnvironmentDiff, getEnvironmentInstallChanges } from "./diff.js";
import type { EnvironmentDependencySnapshot, EnvironmentSnapshot } from "./snapshot.js";

/** 从 manifest 请求 + 本地解析结果构建环境依赖快照（captureCurrentEnvironmentSnapshot 主体）。 */
export function buildEnvironmentDependencies(
    manifestDeps: Dict<string>,
    localDeps: Dict<Dependency>,
) {
    const dependencies: Dict<EnvironmentDependencySnapshot> = {};
    for (const [name, request] of Object.entries(manifestDeps)) {
        const normalizedRequest = request.replace(/^[~^]/, "");
        dependencies[name] = {
            request,
            resolved: localDeps[name]?.resolved,
            workspace: localDeps[name]?.workspace,
            source: localDeps[name]?.source,
            local: localDeps[name]?.local,
            bound: localDeps[name]?.bound,
            // 与 deps/resolver 同一判定口径:非本地且非合法 semver 视为 invalid
            invalid: !localDeps[name]?.local && !valid(normalizedRequest),
        };
    }
    return dependencies;
}

/** 应用环境快照前的纯规划：diff + 不可恢复项 + 安装请求变化。 */
export function planEnvironmentApply(current: EnvironmentSnapshot, target: EnvironmentSnapshot) {
    const diff = getEnvironmentDiff(current, target);
    const unsupported = diff.filter((change) => change.status === "unsupported");
    const changes = getEnvironmentInstallChanges(diff, target);
    return { diff, unsupported, changes };
}
