/**
 * 安装域（install）的公共类型定义。
 *
 * 集中声明安装流水线各部件共享的接口：日志器（InstallLogger）、安装选项
 * （InstallOptions）、编排器依赖面（InstallOrchestratorDeps）与安装历史
 * （InstallHistory*）等。pipeline / logs / sources 子模块按需从此处导入，
 * 避免类型定义分散导致的循环依赖。
 *
 * 设计要点：InstallOrchestratorDeps 是 core 层「I/O 构造注入」的典型样本——
 * 除领域对象（resolver/registry/queue/logs 等）外，还包含一组由 P3 适配层
 * （src/node）接线的回调（refreshChannels/fullReload/isActive 等），
 * 使 core 在不依赖 koishi 运行时的前提下完成安装编排。
 */
import type { DependencyResolver } from "../deps/resolver.js";
import type { EnvironmentSnapshotStore } from "../environment/snapshot.js";
import type { RequestScope } from "../racing/request-scope.js";
import type { PackageCache } from "../registry/cache/index.js";
import type { RegistryClient } from "../registry/client/index.js";
import type { InstallLogStore } from "./logs/store.js";
import type { InstallQueue } from "./pipeline/queue.js";
import type { PackageManagerAgent } from "./pipeline/runner.js";

/** 安装域内部使用的极简日志器接口（koishi Logger 的结构性子集，便于注入与测试）。 */
export interface InstallLogger {
    debug(message: string): void;
    info(message: string): void;
    warn(message: unknown): void;
    error(message: unknown): void;
}

/** 单次安装的附加选项（当前仅支持指定临时 registry 端点）。 */
export interface InstallOptions {
    /** 本次安装使用的 npm registry 端点；缺省时回退编排器配置的端点 */
    installEndpoint?: string | undefined;
}

/** 安装编排器的用户配置（对应插件 config 中的 install 节）。 */
export interface InstallOrchestratorConfig {
    /** 默认包管理器 registry 端点；为空则不传 --registry */
    endpoint?: string | undefined;
    /** 包管理器执行超时（毫秒） */
    timeout?: number | undefined;
}

/**
 * InstallOrchestrator / InstallExecutor 的构造依赖面。
 * 后六个回调是 P3 适配层接到 Koishi 的接线点（通道刷新、整帧重载、生命周期判定）。
 */
export interface InstallOrchestratorDeps {
    /** 宿主应用根目录（package.json 所在处） */
    cwd: string;
    log: InstallLogger;
    config: InstallOrchestratorConfig;
    /** 端点竞速失效域：安装后刷新依赖状态时 advance 使旧请求作废 */
    scope: RequestScope;
    registry: RegistryClient;
    packages: PackageCache;
    resolver: DependencyResolver;
    environments: EnvironmentSnapshotStore;
    queue: InstallQueue;
    logs: InstallLogStore;
    /** 已探测的包管理器（npm/yarn/pnpm，含版本）；undefined 表示未知 */
    agent: PackageManagerAgent | undefined;
    /** console.refresh ×4（dependencies/registry/registryStatus/packages） */
    refreshChannels: () => Promise<unknown>;
    /** console.refresh('dependencies') 单通道 */
    refreshDependenciesChannel: () => Promise<unknown> | undefined;
    /** 清空 registryStatus 通道的失败归因状态 */
    clearRegistryStatus: () => void;
    /** 整帧重载（ctx.loader.fullReload 的注入点） */
    fullReload: () => void;
    /** 宿主 scope 是否仍存活（重载前检查，防止已停机的插件再触发重载） */
    isActive: () => boolean;
    /** require.resolve(name) in require.cache 的等价判定（含解析失败 → true） */
    isPackageLoaded: (name: string) => boolean;
}

/** 安装历史条目的状态：running（进行中）/ success / error / unknown（无法判定，多为残留日志）。 */
export type InstallHistoryStatus = "running" | "success" | "error" | "unknown";

/** 单个依赖在一次安装前后的请求串与解析版本对照（历史「变更」面板的数据源）。 */
export interface InstallHistoryChange {
    name: string;
    /** 操作前 package.json 中的请求串；依赖原不存在则为 null */
    beforeRequest: string | null;
    /** 操作前已解析的版本（来自本地依赖缓存）；未安装则为 null */
    beforeResolved: string | null;
    /** 操作后写入的请求串；空请求（删除依赖）归一为 null */
    afterRequest: string | null;
    /** 操作后解析的版本；安装成功时由日志收尾回填，失败保持 null */
    afterResolved: string | null;
}

/** 安装历史列表的一条记录（.log.json 元数据 + 文件大小的组装结果）。 */
export interface InstallHistoryEntry {
    /** 日志文件名（含 .log 后缀），同时作为唯一标识 */
    id: string;
    startedAt: number;
    finishedAt?: number | undefined;
    /** 毫秒时长（finishedAt - startedAt）；未完成则缺省 */
    duration?: number | undefined;
    status: InstallHistoryStatus;
    /** 本次操作的依赖请求串摘要（formatDeps 输出） */
    deps: string;
    /** 是否强制执行（跳过「已满足」优化，直接跑包管理器） */
    forced: boolean;
    installEndpoint?: string | undefined;
    /** 日志文件字节数 */
    size: number;
    changes: InstallHistoryChange[];
}

/** npm pack 本地绑定的结果（写进 .yarn/local/ 后的摘要）。 */
export interface LocalBindingResult {
    /** 写入 package.json 的依赖请求串，形如 file:.yarn/local/xxx.tgz */
    request: string;
    /** 落地的 tgz 文件名（含哈希的规范名） */
    filename: string;
    size: number;
}

/** 安装日志详情：历史条目 + 日志正文（可能截断）。 */
export interface InstallLogDetail extends InstallHistoryEntry {
    /** 日志正文（已 ANSI 清洗）；大文件时为头尾拼接并省略中段 */
    content: string;
    /** 是否因超出读取上限而截断 */
    truncated: boolean;
}

/** 安装日志的持久化元数据（.log.json）。 */
export interface InstallHistoryMetadata {
    version: 1;
    id: string;
    startedAt: number;
    finishedAt?: number | undefined;
    status: InstallHistoryStatus;
    deps: string;
    forced: boolean;
    installEndpoint?: string | undefined;
    changes: InstallHistoryChange[];
}
