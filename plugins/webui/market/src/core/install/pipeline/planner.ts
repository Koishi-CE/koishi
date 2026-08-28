/**
 * @file 安装计划器(core/install/pipeline 域):纯函数集合。
 *
 * 职责:格式化依赖变更(日志展示)、构建安装历史变更记录,以及判定
 * "这次变更是否真的需要跑包管理器"(本地来源或已满足的请求可直接跳过,
 * 省一次子进程往返)。不做任何 I/O,被 install-executor 与
 * install-reporting 消费。
 */
import type { Dict } from "@koishi-ce/koishi";
import { satisfies } from "semver";
import { classifyDependencySource } from "../../../shared/dependency-source.js";
import type { Dependency } from "../../deps/types.js";
import type { InstallHistoryChange } from "../types.js";

/** 把目标依赖表格式化为 "name@version, ..." 形式(空串版本表示移除)。 */
export function formatDeps(deps: Dict<string>) {
    const entries = Object.entries(deps);
    if (!entries.length) return "(none)";
    return entries.map(([name, version]) => `${name}@${version || "(remove)"}`).join(", ");
}

/** 把本地依赖快照格式化为含 request/resolved/source/local 的调试串。 */
export function formatLocalDeps(deps: Dict<Dependency>) {
    const entries = Object.entries(deps);
    if (!entries.length) return "(none)";
    return entries
        .map(
            ([name, dep]) =>
                `${name}{request=${dep.request || "-"},resolved=${dep.resolved ?? "-"},source=${dep.source ?? "-"},local=${!!dep.local}}`,
        )
        .join(", ");
}

/**
 * 构建安装历史的变更明细:以目标依赖表(after)为底,逐项记录变更前后的
 * 请求串与已装版本。afterResolved 此处恒为 null,由 InstallLogStore 定稿时
 * 依据最新依赖缓存回填。
 */
export function createInstallHistoryChanges(
    before: Dict<string>,
    after: Dict<string>,
    localDeps: Dict<Dependency>,
): InstallHistoryChange[] {
    return Object.keys(after).map((name) => ({
        name,
        beforeRequest: Object.hasOwn(before, name) ? before[name]! : null,
        beforeResolved: localDeps[name]?.resolved ?? null,
        afterRequest: after[name] || null,
        afterResolved: null,
    }));
}

/**
 * 判断是否需要真的跑包管理器（无变化/已满足的请求可跳过）。
 * 规则:forced 一律要跑;任一依赖是"移除"、请求串变化且涉及本地来源
 * (workspace/file:)切换、或目标请求未被当前已装版本满足时,都要跑;
 * 全部满足(含本地依赖天然免装)才允许跳过。
 */
export function requiresPackageManager(
    deps: Dict<string>,
    localDeps: Dict<Dependency>,
    manifestDeps: Dict<string>,
    depCache: Dict<Dependency>,
    forced?: boolean,
) {
    if (forced) return true;
    for (const name in deps) {
        const nextRequest = deps[name];
        const currentRequest = manifestDeps[name];
        const currentSource = classifyDependencySource(currentRequest ?? "", {
            workspace: depCache[name]?.workspace,
            installed: !!depCache[name]?.resolved,
        });
        const nextSource = classifyDependencySource(nextRequest ?? "", {
            workspace: localDeps[name]?.workspace,
            installed: !!localDeps[name]?.resolved,
        });
        // 空请求 = 移除该依赖,必须交给包管理器处理
        if (!nextRequest) return true;
        // 请求串变了且任一侧是本地来源:本地包的增删换不跑 PM 就不会生效
        if (currentRequest !== nextRequest && (currentSource.local || nextSource.local))
            return true;
        const { resolved, local } = localDeps[name] || {};
        if (local || (resolved && satisfies(resolved, nextRequest, { includePrerelease: true })))
            continue;
        return true;
    }
    return false;
}
