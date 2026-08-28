/**
 * @file 单依赖条目的 latest 元数据刷新协程(core/deps 域)。
 *
 * 从 DependencyResolver.refreshMetadata 成块拆出的单包处理:拉取 registry
 * 元数据填充 latest;全路由 404 的条目经 markNotFound 回调交回
 * DependencyResolver 归类为"未绑定本地插件";过期(serial 陈旧)时静默跳过。
 *
 * 架构位置:被 deps/resolver 的 refreshMetadata 以 p-map 并发调度,
 * I/O 全部经传入的 deps(DependencyResolverDeps)访问。
 */
import type { DependencyResolverDeps } from "./resolver.js";
import type { Dependency } from "./types.js";

/** 单包刷新选项:目标条目、竞速轮次、宿主依赖面与 404 归类回调。 */
export interface DependencyRefreshOptions {
    name: string;
    /** 就地修改的目标条目(refreshMetadata 的 result[name]) */
    entry: Dependency;
    /** 竞速轮次,过期结果直接丢弃 */
    serial: number;
    deps: DependencyResolverDeps;
    /** 404 归类回调(委托 DependencyResolver.markRegistryNotFoundDependency)。 */
    markNotFound: (dependency: Dependency | undefined) => boolean;
}

/** 拉取单个依赖的 latest 元数据并就地写回 entry。 */
export async function refreshDependencyLatest(options: DependencyRefreshOptions): Promise<void> {
    const { name, entry, serial, deps, markNotFound } = options;
    if (deps.scope.isStale(serial)) return;
    try {
        const versions = await deps.cache.getPackage(name);
        if (deps.scope.isStale(serial)) return;
        if (versions) {
            entry.latest = Object.keys(versions)[0];
            deps.log.debug(
                `dependency latest resolved: ${name}, resolved=${entry.resolved ?? "-"}, latest=${entry.latest}, versions=${Object.keys(versions).length}`,
            );
        } else if (deps.cache.isNotFoundCached(name) && markNotFound(entry)) {
            deps.log.debug(`dependency npm not-found result reused from cache: ${name}`);
        } else {
            deps.log.debug(
                `dependency latest unresolved: ${name}, resolved=${entry.resolved ?? "-"}, request=${entry.request}`,
            );
        }
    } catch (error) {
        if (deps.scope.isStale(serial)) return;
        const detail = deps.formatError(error);
        if (detail.reason === "not-found" && markNotFound(entry)) {
            // 全路由 404 可确认：已安装、registry 形态命名的插件实为本地包
        } else {
            deps.log.debug(
                `dependency metadata refresh skipped after error: ${name}, reason=${detail.reason}, error=${detail.error}`,
            );
        }
    }
}
