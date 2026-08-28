/**
 * @file installer 组装线的类型定义:宿主回写面与 core 入口类集合。
 *
 * 模块职责:
 * - InstallerWireOwner:core 各入口类回写宿主(广播 registry 状态、触发
 *   刷新)时依赖的宿主面,由 Installer 类实现;
 * - InstallerCore:createInstallerCore 组装出的 core 入口类集合,Installer
 *   构造函数按字段逐一接引。
 *
 * 关键设计:
 * - 类型与组装逻辑分离:两个接口只描述"谁提供什么、组装产出什么",
 *   构造顺序与共享引用细节留在 wire.ts;
 * - owner 回调是 core 反向触碰 koishi 通道的唯一出口,保持依赖单向。
 *
 * 架构位置:node 适配层 installer 模块,由 wire.ts(组装)与
 * installer/index.ts(实现/消费)引用。
 */
import type { Dict } from "@koishi-ce/koishi";
import type { DependencyResolver } from "../../core/deps/resolver.js";
import type { EnvironmentSnapshotStore } from "../../core/environment/snapshot.js";
import type { EnvironmentSnapshotOps } from "../../core/install/environment.js";
import type { InstallLogRetention } from "../../core/install/logs/retention.js";
import type { InstallLogStore } from "../../core/install/logs/store.js";
import type { InstallOrchestrator } from "../../core/install/pipeline/orchestrator.js";
import type { InstallQueue } from "../../core/install/pipeline/queue.js";
import type { PackageManagerAgent } from "../../core/install/pipeline/runner.js";
import type { LocalPackageUploadService } from "../../core/install/sources/upload.js";
import type { InstallLogger } from "../../core/install/types.js";
import type { RequestScope } from "../../core/racing/request-scope.js";
import type { RouteStatsBook } from "../../core/racing/stats.js";
import type { PackageCache } from "../../core/registry/cache/index.js";
import type { RegistryStatsStore } from "../../core/registry/cache/stats-file.js";
import type { RegistryClient } from "../../core/registry/client/index.js";
import type { LocalPackageUploadStore } from "../../core/upload/session.js";
import type { JsonStore } from "../../core/utils/json-store.js";
import type { RegistryStatus } from "../../shared/types.js";

/** installer 构造期间 core 各入口类需要回掉的宿主面（由 Installer 提供）。 */
export interface InstallerWireOwner {
    log: InstallLogger;
    cwd: string;
    agent: PackageManagerAgent;
    setRegistryStatus(name: string, status: Partial<RegistryStatus>, serial: number): void;
    refreshData(): Promise<unknown>;
    clearRegistryStatus(): void;
    isPackageLoaded(name: string): boolean;
    /** 取出并清空待广播的 registry 状态增量（保持 tempRegistryStatus 单点归属）。 */
    drainRegistryStatus(): Dict<RegistryStatus>;
}

/** installer 构造组装出的 core 入口类集合。 */
export interface InstallerCore {
    /** 竞速失效域:请求序号判定,新一轮刷新作废上一轮的迟到结果 */
    scope: RequestScope;
    /** registry 多端点路由竞速统计(内存) */
    stats: RouteStatsBook;
    /** 路由统计的磁盘持久化(cache/market-next-registry-stats.json) */
    statsFile: JsonStore<RegistryStatsStore>;
    /** registry HTTP 客户端(多端点竞速/重试/自动路由) */
    registry: RegistryClient;
    /** 包版本元数据缓存(含 404 负缓存) */
    packages: PackageCache;
    /** 宿主依赖快照与 latest 元数据刷新 */
    resolver: DependencyResolver;
    /** 环境快照存储(安装前后的 package.json 快照) */
    environments: EnvironmentSnapshotStore;
    /** 安装任务串行队列 */
    queue: InstallQueue;
    /** 安装日志存储与实时广播 */
    logs: InstallLogStore;
    /** 安装编排器(override 合并/执行/回滚的主流程) */
    orchestrator: InstallOrchestrator;
    /** 环境快照操作(预览/应用) */
    envOps: EnvironmentSnapshotOps;
    /** 安装日志保留策略(清理过期日志) */
    retention: InstallLogRetention;
    /** 本地 .tgz 上传会话存储 */
    uploads: LocalPackageUploadStore;
    /** 本地包上传服务(分块接收/预览/提交) */
    uploadService: LocalPackageUploadService;
    /** 节流后的 registry 状态广播(手动触发用) */
    flushRegistryStatus: () => void;
}
