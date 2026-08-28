import type { Dict } from "@koishi-ce/koishi";
import {
    findDependenciesNeedingSourceCheck,
    findUnboundLocalDependencies,
} from "../../../shared/dependency-source.js";
import type { DependencyResolver } from "../../deps/resolver.js";
import type { Dependency } from "../../deps/types.js";
import type { PackageCache } from "../../registry/cache/index.js";
import type { RegistryClient } from "../../registry/client/index.js";
import type { InstallLogger } from "../types.js";

export interface LocalSourceCheckDeps {
    packages: PackageCache;
    resolver: DependencyResolver;
    registry: RegistryClient;
    /** console.refresh('dependencies') 单通道 */
    refreshDependenciesChannel: () => Promise<unknown> | undefined;
    log: InstallLogger;
}

/**
 * 跑包管理器前确认已安装插件来源（避免把本地插件误当 npm 包下载）。
 * 成块移植自旧 Installer 的来源校验逻辑，算法未改。
 */
export async function resolveLocalSources(
    deps: LocalSourceCheckDeps,
    depCache: Dict<Dependency>,
    requests: Dict<string>,
) {
    await checkUnresolvedSources(deps, depCache, requests);
    checkUnboundLocalDeps(depCache, requests);
}

/**
 * unresolved 分支：逐个检查待确认来源的插件。
 * 返回是否发生了来源状态变化；有变化时先刷新依赖通道，再决定是否抛出 uncertain 错误。
 */
async function checkUnresolvedSources(
    deps: LocalSourceCheckDeps,
    depCache: Dict<Dependency>,
    requests: Dict<string>,
): Promise<boolean> {
    let sourceStateChanged = false;
    const completedSourceChecks = Object.keys(deps.packages.fullCache);
    const unresolved = findDependenciesNeedingSourceCheck(
        depCache,
        requests,
        completedSourceChecks,
    );
    if (!unresolved.length) return sourceStateChanged;
    deps.log.info(
        `resolve possible local plugin sources before package manager: ${unresolved.join(", ")}`,
    );
    const unresolvedErrors = await Promise.all(
        unresolved.map(async (name) => {
            try {
                const versions = await deps.packages.getPackage(name);
                if (versions) return undefined;
                if (deps.packages.isNotFoundCached(name)) {
                    sourceStateChanged =
                        deps.resolver.markRegistryNotFoundDependency(name) || sourceStateChanged;
                    return undefined;
                }
                return {
                    name,
                    error: Object.assign(
                        new Error("npm metadata check completed without a result"),
                        { marketNextReason: "unknown" },
                    ),
                };
            } catch (error) {
                if (deps.registry.formatError(error).reason === "not-found") {
                    sourceStateChanged =
                        deps.resolver.markRegistryNotFoundDependency(name) || sourceStateChanged;
                    return undefined;
                }
                return { name, error };
            }
        }),
    );
    const uncertain = unresolvedErrors.filter((item): item is { name: string; error: unknown } => {
        if (!item) return false;
        return deps.registry.formatError(item.error).reason !== "not-found";
    });
    if (sourceStateChanged) {
        await deps.refreshDependenciesChannel();
    }
    if (uncertain.length) {
        throw new Error(
            `暂时无法确认以下已安装插件是否来自 npm：${uncertain.map((item) => item.name).join(", ")}。为避免包管理器误下载本地插件，本次操作已取消；请检查 npm 网络后重试。`,
        );
    }
    return sourceStateChanged;
}

/**
 * blockers 分支：检测到来源未绑定的本地插件时直接抛错。
 */
function checkUnboundLocalDeps(depCache: Dict<Dependency>, requests: Dict<string>) {
    const blockers = findUnboundLocalDependencies(depCache, requests);
    if (!blockers.length) return;
    throw new Error(
        `检测到来源未绑定的本地插件，继续安装会让包管理器尝试从 npm 下载它们：${blockers.join(", ")}。请先在“本地插件”分组中绑定来源或移除这些依赖。`,
    );
}
