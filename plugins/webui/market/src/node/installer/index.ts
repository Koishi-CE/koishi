/**
 * ctx.installer 服务实现（Installer 服务门面）。
 *
 * 模块职责：保持旧版 ctx.installer 的全部 public 方法签名不变，把 core 层的
 * registry / deps / install / upload 等领域入口类组装成一个 Koishi 服务。
 * 门面自身不承载业务逻辑，只做三件事：转发调用、管理 koishi 通道的广播与刷新、
 * 提供少量宿主能力（require 探测、包管理器探测、生命周期清理）。
 *
 * 关键设计：
 * - core 入口类统一在 wire.ts 的 createInstallerCore 中按固定顺序构造，彼此共享同一
 *   RequestScope / RouteStatsBook 引用；本类只持有引用并逐一转发。
 * - core 反向触碰 koishi 的出口全部收拢为 owner 回调（statusSink / refreshData /
 *   clearRegistryStatus / isPackageLoaded / drainRegistryStatus），保持依赖单向。
 * - registry 状态的增量收集（tempRegistryStatus）与 200ms 节流广播由本类单点管理。
 *
 * 架构位置：src/node 适配层；由 src/node/index.ts 注入，listeners / commands /
 * market 等模块经 ctx.installer 消费。业务规则见 core/install（编排）与
 * core/registry（元数据访问）。
 */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { RemotePackage } from "@koishi-ce/registry";
import { type Context, type Dict, type HTTP, Service, Time } from "@koishi-ce/koishi";
import { detect } from "package-manager-detector";
import type { DependencyResolver } from "../../core/deps/resolver.js";
import type { EnvironmentSnapshotOps } from "../../core/install/environment.js";
import type { InstallOrchestrator } from "../../core/install/pipeline/orchestrator.js";
import type { InstallQueue } from "../../core/install/pipeline/queue.js";
import { type PackageManagerAgent, runPackageManager } from "../../core/install/pipeline/runner.js";
import {
    overrideDependencies,
    snapshotPackageManifest,
    writeManifest,
} from "../../core/install/sources/manifest-restore.js";
import type { InstallOptions } from "../../core/install/types.js";
import type { PackageCache, PackageVersions } from "../../core/registry/cache/index.js";
import type { RegistryStatsStore } from "../../core/registry/cache/stats-file.js";
import type { RegistryClient } from "../../core/registry/client/index.js";
import { resolvePluginName } from "../../core/registry/manifest.js";
import type { LocalPackageUploadStore } from "../../core/upload/session.js";
import type { JsonStore } from "../../core/utils/json-store.js";
import type { InstallFallbackCandidate } from "../../shared/types.js";
import { refreshConsole } from "../console/refresh.js";
import type { InstallerConfig, InstallerGetDepsOptions } from "./config.js";
import { LogsMixin } from "./logs.js";
import { RegistryStatusMixin } from "./registry-status.js";
import { UploadsMixin } from "./uploads.js";
import { createInstallerCore, createInstallLogger } from "./wire.js";

/** 本插件自身的包名：安装请求包含它时视为“插件自更新”，需要走特殊的确认与重载流程。 */
export const SELF_PACKAGE = "@koishi-ce/plugin-marketn";

/**
 * installer 服务门面：保持 ctx.installer 全部 public 方法签名不变，
 * 内部把 core 各「入口类」组装起来，并负责 koishi 通道的广播/刷新/生命周期。
 * 上传 / 安装日志 / registry 状态管理按职责拆入 UploadsMixin / LogsMixin /
 * RegistryStatusMixin，本类只保留核心转发与生命周期管理。
 */
export class Installer extends RegistryStatusMixin(UploadsMixin(LogsMixin(Service))) {
    /** 宿主全局 HTTP 客户端（透传给需要裸 HTTP 的调用方）。 */
    public http: HTTP;
    /** 插件级配置（endpoint/timeout/retry/concurrency 等，定义见 config.ts）。 */
    public override config: InstallerConfig;

    /** registry 路由学习数据的防抖落盘句柄（cache/market-next-registry-stats.json）。 */
    private readonly statsFile: JsonStore<RegistryStatsStore>;
    /** npm registry 元数据访问门面（多端点路由 / 重试 / 探测）。 */
    private readonly registry: RegistryClient;
    /** 包版本三层缓存（全量 / 增量 / 404 负缓存）。 */
    private readonly packages: PackageCache;
    /** 宿主 package.json 依赖解析器（dependencies 通道的数据源）。 */
    private readonly resolver: DependencyResolver;
    /** 安装串行锁：同一时刻只允许一个安装 / 环境恢复在跑。 */
    private readonly queue: InstallQueue;
    /** 安装编排状态机（install / installLocked 主流程）。 */
    private readonly orchestrator: InstallOrchestrator;
    /** 环境快照列表 / 预览 / 恢复入口。 */
    private readonly envOps: EnvironmentSnapshotOps;
    /** 本地包分块上传会话存储（带 TTL 过期清理）。 */
    private readonly uploads: LocalPackageUploadStore;
    /** 包管理器信息（异步探测，默认 npm）；对象与 core runner 共享，探测完成后原地回填。 */
    private readonly agent: PackageManagerAgent = { name: "npm" };

    constructor(ctx: Context, config: InstallerConfig = {}) {
        super(ctx, "installer");
        this.config = config;
        this.log = createInstallLogger(ctx.logger("market"));
        // 以宿主 package.json 为基准创建 require，后续才能探测“宿主已加载了哪些插件”
        this.require = createRequire(resolve(ctx.baseDir, "package.json"));
        this.http = ctx.http;

        // 组装 core 各入口类；owner 回调是 core 反向触碰 koishi 通道（状态写入、通道刷新、
        // 状态清空、包加载探测、状态增量取用）的唯一出口，收拢在此单点提供
        const core = createInstallerCore(ctx, config, {
            log: this.log,
            cwd: this.cwd,
            agent: this.agent,
            setRegistryStatus: (name, status, serial) =>
                this.setRegistryStatus(name, status, serial),
            refreshData: () => this.refreshData(),
            clearRegistryStatus: () => this.clearRegistryStatus(),
            isPackageLoaded: (name) => this.isPackageLoaded(name),
            drainRegistryStatus: () => this.drainRegistryStatus(),
        });
        this.scope = core.scope;
        this.statsFile = core.statsFile;
        this.registry = core.registry;
        this.packages = core.packages;
        this.resolver = core.resolver;
        this.queue = core.queue;
        this.logs = core.logs;
        this.orchestrator = core.orchestrator;
        this.envOps = core.envOps;
        this.retention = core.retention;
        this.uploads = core.uploads;
        this.uploadService = core.uploadService;
        this.flushRegistryStatus = core.flushRegistryStatus;

        void detect().then((result) => {
            if (result) {
                this.agent.name = result.name;
                this.agent.version = result.version;
            }
        });

        ctx.setInterval(() => void this.uploads.pruneExpired(), Time.minute * 5);
        ctx.effect(() => () => {
            this.scope.dispose("installer disposed");
            void this.uploads.dispose();
        });
    }

    get cwd() {
        return this.ctx.baseDir;
    }

    get isInstalling() {
        return this.queue.isInstalling;
    }

    get fullCache(): Dict<PackageVersions> {
        return this.packages.fullCache;
    }

    get tempCache(): Dict<PackageVersions> {
        return this.packages.tempCache;
    }

    get endpoint() {
        return this.registry.endpoint;
    }

    override async start() {
        await this.registry.restoreStats(await this.statsFile.read());
        await this.registry.resetEndpoint();
        this.log.info(
            `npm registry endpoint initialized: ${this.registry.endpoint}, timeout=${this.config.timeout ?? "default"}, autoRoute=${this.config.autoRoute !== false}`,
        );
        await this.orchestrator.recordCurrentEnvironmentSnapshot("startup").catch((error) => {
            this.log.warn(
                `failed to record startup environment snapshot: ${error instanceof Error ? error.message : error}`,
            );
        });
        await this.resolver.getDeps({ background: false });
        void this.resolver.refreshDependencyMetadata(false);
    }

    resolveName(name: string) {
        return resolvePluginName(name);
    }

    findVersion(names: string[]) {
        return this.packages.findVersion(names);
    }

    getInstallFallbackCandidate(failedEndpoint?: string): InstallFallbackCandidate | undefined {
        return this.registry.getInstallFallbackCandidate(failedEndpoint);
    }

    getRegistry(name: string, serial?: number) {
        return this.registry.getRegistry(name, serial);
    }

    setPackage(name: string, versions: RemotePackage[]) {
        this.packages.setPackage(name, versions);
    }

    getPackage(name: string) {
        return this.packages.getPackage(name);
    }

    refreshDependencyMetadata(wait = false) {
        return this.resolver.refreshDependencyMetadata(wait);
    }

    async probeDependenciesInBackground(reason = "background") {
        const start = Date.now();
        await this.orchestrator.refreshDependencyState();
        await this.resolver.refreshDependencyMetadata(true);
        await this.refreshData();
        this.log.info(`dependency ${reason} probe completed: elapsed=${Date.now() - start}ms`);
    }

    getDeps(options: InstallerGetDepsOptions = {}) {
        return this.resolver.getDeps(options);
    }

    async refreshData() {
        await refreshConsole(this.ctx, ["dependencies", "registry", "registryStatus", "packages"]);
    }

    async refresh(refresh = false, waitMetadata = false) {
        await this.orchestrator.refreshDependencyState();
        const metadataTask = this.resolver.refreshDependencyMetadata(true);
        if (!refresh) return;
        await this.refreshData();
        if (waitMetadata) await metadataTask;
    }

    getEnvironmentSnapshots() {
        return this.envOps.getEnvironmentSnapshots();
    }

    getEnvironmentSnapshotPreview(id: string) {
        return this.envOps.getEnvironmentSnapshotPreview(id);
    }

    exec(args: string[]) {
        return runPackageManager(args, {
            cwd: this.cwd,
            agent: this.agent,
            log: this.log,
            emitLog: (type, line) => this.logs.emit(type, line),
        });
    }

    async override(deps: Dict<string>) {
        const snapshot = await snapshotPackageManifest(this.cwd);
        overrideDependencies(snapshot.manifest, deps);
        await writeManifest(this.cwd, snapshot.manifest);
    }

    install(
        deps: Dict<string>,
        forced?: boolean,
        beforeReload?: () => unknown,
        options: InstallOptions = {},
    ) {
        return this.orchestrator.install(deps, forced, beforeReload, options);
    }

    applyEnvironmentSnapshot(id: string, options: InstallOptions = {}) {
        return this.envOps.applyEnvironmentSnapshot(id, options);
    }

    isSelfUpdate(deps: Dict<string>) {
        return Object.hasOwn(deps, SELF_PACKAGE);
    }
}
