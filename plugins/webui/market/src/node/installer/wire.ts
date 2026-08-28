/**
 * @file Installer 的 core 装配线:把 core 领域入口类组装进 koishi 上下文。
 *
 * 模块职责:
 * - createInstallerCore:按依赖顺序构造 core 全部入口类(RequestScope/
 *   RouteStatsBook/RegistryClient/PackageCache/DependencyResolver/安装编排
 *   器/环境快照/安装日志/本地上传等),并注入 koishi 侧的 I/O 适配
 *   (ctx.http、loader.fullReload、console broadcast 等);
 * - 类型定义(InstallerCore/InstallerWireOwner)见 types.ts,日志适配
 *   (createInstallLogger)见 logger.ts,本文件只承载组装逻辑。
 *
 * 关键设计:
 * - 这是 core 层"禁 koishi、构造注入 I/O"约定的落点:所有 ctx.* 调用
 *   集中在本文件,core 类只见回调与接口;
 * - 共享引用(scope/stats/cache 等)只构造一次、多处复用,保证竞速失效
 *   与缓存全局一致;
 * - 广播一律走 ctx.throttle 节流(registry-status 200ms / registry
 *   500ms),避免高频更新打爆 WebSocket。
 *
 * 架构位置:node 适配层 installer 模块,由 installer/index.ts 的 Installer
 * 构造函数调用一次。
 */
import { resolve } from "node:path";
import type { Registry } from "@koishi-ce/registry";
import getRegistry from "get-registry";
import type { Context, Dict } from "@koishi-ce/koishi";
import { DependencyResolver } from "../../core/deps/resolver.js";
import type { Dependency } from "../../core/deps/types.js";
import { EnvironmentSnapshotStore } from "../../core/environment/snapshot.js";
import { EnvironmentSnapshotOps } from "../../core/install/environment.js";
import { getInstallLogRetention, InstallLogRetention } from "../../core/install/logs/retention.js";
import { InstallLogStore } from "../../core/install/logs/store.js";
import { InstallOrchestrator } from "../../core/install/pipeline/orchestrator.js";
import { InstallQueue } from "../../core/install/pipeline/queue.js";
import { LocalPackageUploadService } from "../../core/install/sources/upload.js";
import { RequestScope } from "../../core/racing/request-scope.js";
import { RouteStatsBook } from "../../core/racing/stats.js";
import { PackageCache } from "../../core/registry/cache/index.js";
import type { RegistryStatsStore } from "../../core/registry/cache/stats-file.js";
import { RegistryClient } from "../../core/registry/client/index.js";
import { type RegistryReason, registryFailurePenalty } from "../../core/registry/errors.js";
import { LocalPackageUploadStore } from "../../core/upload/session.js";
import { JsonStore } from "../../core/utils/json-store.js";
import { refreshConsole } from "../console/refresh.js";
import type { InstallerConfig } from "./config.js";
import type { InstallerCore, InstallerWireOwner } from "./types.js";

export { createInstallLogger } from "./logger.js";
// 契约面转发:类型与日志适配已拆至 types.ts / logger.ts,原导出位置保持不变
export type { InstallerCore, InstallerWireOwner };

/** registry 请求耗时低于该阈值(ms)计为"快路由",参与路由竞速统计。 */
const REGISTRY_FAST_ROUTE_THRESHOLD = 800;

/** 组装 Installer 依赖的 core 入口类（保持构造顺序与共享引用不变）。 */
export function createInstallerCore(
    ctx: Context,
    config: InstallerConfig,
    owner: InstallerWireOwner,
): InstallerCore {
    const scope = new RequestScope({ isActive: () => ctx.scope.isActive });
    const stats = new RouteStatsBook({
        fastThreshold: REGISTRY_FAST_ROUTE_THRESHOLD,
        // 成功加分/失败扣分都做钳制:单次结果不会让某端点权重失真
        successClamp: [-6, 3],
        failureClamp: [-8, 3],
        failurePenalty: (options) =>
            Math.min(1.5, registryFailurePenalty(options.reason as RegistryReason | undefined)),
        cooldown: () => 0,
        roundAverage: true,
        trackFailureMeta: true,
    });
    const statsFile = new JsonStore<RegistryStatsStore>(
        resolve(ctx.baseDir, "cache", "market-next-registry-stats.json"),
        {
            isActive: () => ctx.scope.isActive,
            onError: (error) =>
                owner.log.debug(
                    `failed to write registry route stats: ${error instanceof Error ? error.message : error}`,
                ),
        },
    );

    // registry 状态广播节流 200ms:客户端只感知聚合后的结果,不逐请求推送
    const flushRegistryStatus = ctx.throttle(() => {
        const status = owner.drainRegistryStatus();
        void ctx.get("console")?.broadcast("market/registry-status", { ...status });
    }, 200);

    const registry = new RegistryClient(
        {
            httpFactory: (endpoint) => ({
                get: (path, cfg) =>
                    ctx.http
                        .extend({
                            endpoint,
                            ...(config.timeout === undefined ? {} : { timeout: config.timeout }),
                        })
                        .get(path, cfg) as Promise<Registry>,
            }),
            isHttpError: (error) => ctx.http.isError(error),
            stats,
            statsFile,
            scope,
            defaultEndpoint: async () => (await getRegistry()) ?? "https://registry.npmjs.org",
            statusSink: (name, status, serial) => owner.setRegistryStatus(name, status, serial),
            log: owner.log,
        },
        {
            endpoint: config.endpoint,
            timeout: config.timeout,
            autoRoute: config.autoRoute,
            retry: config.retry,
        },
    );

    const packages = new PackageCache({
        client: registry,
        scope,
        log: owner.log,
        // 缓存回填按 500ms 节流批量广播,而不是每个包一次
        onFlush: ctx.throttle(() => {
            void ctx.get("console")?.broadcast("market/registry", {
                ...packages.tempCache,
            });
            packages.tempCache = {};
        }, 500),
    });

    const resolver = new DependencyResolver({
        cwd: () => owner.cwd,
        cache: packages,
        scope,
        concurrency: () => config.concurrency,
        formatError: (error) => registry.formatError(error),
        ensureProbe: (name) => registry.ensureMetadataEndpoint(name, scope.current),
        log: owner.log,
        onMetadataRefreshed: () => void refreshConsole(ctx, ["dependencies"]),
    });

    const environments = new EnvironmentSnapshotStore(
        resolve(ctx.baseDir, "data", "market-next-environment-snapshots.json"),
        (message) => owner.log.warn(message),
    );

    const queue = new InstallQueue(owner.log);
    const retention = new InstallLogRetention(
        owner.cwd,
        () => getInstallLogRetention(config),
        owner.log,
    );

    const logs = new InstallLogStore({
        cwd: owner.cwd,
        log: owner.log,
        retention,
        broadcast: (type, line) =>
            void ctx.get("console")?.broadcast("market/install-log", { type, line }),
        resolveAfter: (name) =>
            (resolver.getDeps({ background: false }) as Dict<Dependency>)[name]?.resolved,
    });

    const orchestrator = new InstallOrchestrator({
        cwd: owner.cwd,
        log: owner.log,
        config: { endpoint: config.endpoint, timeout: config.timeout },
        scope,
        registry,
        packages,
        resolver,
        environments,
        queue,
        logs,
        agent: owner.agent,
        refreshChannels: () => owner.refreshData(),
        refreshDependenciesChannel: () => refreshConsole(ctx, ["dependencies"]),
        clearRegistryStatus: () => owner.clearRegistryStatus(),
        fullReload: () => ctx.loader.fullReload(),
        isActive: () => ctx.scope.isActive,
        isPackageLoaded: (name) => owner.isPackageLoaded(name),
    });

    const envOps = new EnvironmentSnapshotOps({
        log: owner.log,
        environments,
        queue,
        orchestrator,
    });

    const uploads = new LocalPackageUploadStore(ctx.baseDir, (message) => owner.log.warn(message));
    const uploadService = new LocalPackageUploadService({
        cwd: owner.cwd,
        log: owner.log,
        timeout: config.timeout,
        uploads,
        resolver,
    });

    return {
        scope,
        stats,
        statsFile,
        registry,
        packages,
        resolver,
        environments,
        queue,
        logs,
        orchestrator,
        envOps,
        retention,
        uploads,
        uploadService,
        flushRegistryStatus,
    };
}
