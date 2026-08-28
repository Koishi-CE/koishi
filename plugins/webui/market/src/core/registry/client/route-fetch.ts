/**
 * @file registry 元数据的多端点竞速(core/registry/client 域)。
 *
 * fetchRegistryByRoute 把候选端点交给共享竞速器(120ms 错峰、慢阈值取
 * 主端点的降级延迟),胜出/失败回调进路由统计;失败只对值得惩罚的归因
 * 记分(如网络错误),404/取消类不惩罚,避免把正常镜像打进冷却。
 *
 * 架构位置:被 RegistryClient.fetchByRoute 使用,fetch.ts 的重试循环与
 * probe.ts 的探测都会走到这里。
 */
import { shouldPenalizeRegistryRoute } from "../../../shared/dependency-source.js";
import { raceEndpoints } from "../../racing/race.js";
import type { RequestScope } from "../../racing/request-scope.js";
import {
    attachRegistryAttemptReasons,
    type RegistryErrorDetail,
    type RegistryReason,
} from "../errors.js";
import type { Registry } from "../manifest.js";

/** registry HTTP 客户端抽象(get 一个包的元数据,node 层注入实现)。 */
export interface RegistryHttpClient {
    get(path: string, config?: { signal?: AbortSignal }): Promise<Registry>;
}

/** 路由竞速所需的客户端依赖面（RegistryClientDeps 的结构性子集 + 记分回调）。 */
export interface RegistryRouteDeps {
    httpFactory: (endpoint: string) => RegistryHttpClient;
    scope: RequestScope;
    log: { debug(message: string): void };
    getFallbackDelay(endpoint: string): number;
    formatError(error: unknown): RegistryErrorDetail;
    recordRouteSuccess(result: { endpoint: string; elapsed: number }): void;
    recordRouteFailure(endpoint: string, reason?: RegistryReason): void;
}

/** 竞速错峰间隔:每个镜像延迟 120ms 启动。 */
const ROUTE_STAGGER = 120;

/** 多端点竞速拉取 npm registry 元数据（旧 Installer 的 fetchRegistryByRoute）。 */
export async function fetchRegistryByRoute(
    deps: RegistryRouteDeps,
    name: string,
    endpoints: string[],
    serial: number,
    onAttempt?: (endpoint: string, attempts: number) => void,
) {
    let attempts = 0;
    const failureReasons: RegistryReason[] = [];
    return raceEndpoints<Registry>({
        endpoints,
        stagger: ROUTE_STAGGER,
        // 慢端点阈值用主端点的降级延迟:主端点越慢,越早放镜像上场
        slowThreshold: deps.getFallbackDelay(endpoints[0]!),
        scope: deps.scope,
        serial,
        fetch: (endpoint, signal) => fetchRegistryEndpoint(deps, name, endpoint, serial, signal),
        onAttempt: (endpoint) => {
            attempts++;
            onAttempt?.(endpoint, attempts);
        },
        onSuccess: (attempt) => deps.recordRouteSuccess(attempt),
        onFailure: (endpoint, error) => {
            const reason = deps.formatError(error).reason;
            if (reason) failureReasons.push(reason);
            // 只惩罚真正的端点问题:404(包不存在)与竞速中止不该拖累镜像评分
            if (shouldPenalizeRegistryRoute(reason)) deps.recordRouteFailure(endpoint, reason);
        },
        log: (message) => deps.log.debug(`npm registry ${message}`),
    }).catch((error: unknown) => {
        // 全军覆没时把各端点的失败归因附到异常上,供上层汇总展示
        attachRegistryAttemptReasons(error, failureReasons);
        throw error;
    });
}

/** 单端点拉取:GET /<name>,校验 versions 形状,过期请求立即终止。 */
async function fetchRegistryEndpoint(
    deps: RegistryRouteDeps,
    name: string,
    endpoint: string,
    serial: number,
    signal?: AbortSignal,
): Promise<{ payload: Registry; elapsed: number }> {
    const attemptStart = Date.now();
    deps.log.debug(`fetch npm registry endpoint: package=${name}, endpoint=${endpoint}`);
    const registry = await deps
        .httpFactory(endpoint)
        .get(`/${name}`, signal ? { signal } : undefined);
    if (deps.scope.isStale(serial)) throw new Error("npm registry route probe stale");
    // versions 非对象 = 返回的不是包元数据(可能是镜像的错误页),视为失败
    if (!registry?.versions || typeof registry.versions !== "object") {
        throw new Error(`invalid registry metadata for ${name}`);
    }
    const elapsed = Date.now() - attemptStart;
    deps.log.debug(
        `fetch npm registry endpoint succeeded: package=${name}, endpoint=${endpoint}, elapsed=${elapsed}ms, versions=${Object.keys(registry.versions).length}`,
    );
    return { payload: registry, elapsed };
}
