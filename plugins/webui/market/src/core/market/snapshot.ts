/**
 * 市场快照组装（getSnapshot 主体）：把索引源状态解析为 market 通道的完整 payload。
 *
 * 关键设计决策：
 * - 经 `SnapshotHost` 结构化接口反向解耦：本模块只依赖 host 提供的只读视图与任务句柄，
 *   不直接依赖 MarketIndexSource（source/host.ts 负责适配），快照组装逻辑可独立单测。
 * - 分层降级策略（顺序即优先级）：后台任务复用 → 现有 payload 直返 → 磁盘缓存预热 →
 *   首次网络限时等待 → 错误降级（旧 payload 标 stale / 空 payload + error），
 *   保证 getSnapshot 永不长时间阻塞、也尽量不返回空数据。
 * 成块移植自旧 MarketProvider.getSnapshot / createPayload。
 */
import type { SearchObject, SearchResult } from "@koishi-ce/registry";
import type { Dict } from "@koishi-ce/koishi";
import type { MarketPayload, MarketPerformance } from "../../shared/types.js";
import { waitFor } from "../utils/async.js";
import { formatError } from "../utils/format.js";

/** 首次网络拉取的等待上限（ms）：超时先返回 loading payload，结果就绪后再经 notifyRefresh 推送。 */
const FIRST_PAYLOAD_TIMEOUT = 1500;

/** getSnapshot 的宿主接口：source 状态的只读视图 + 任务句柄。 */
export interface SnapshotHost {
    /** 是否已有可展示数据（决定是否需要等待预热/网络） */
    hasCurrentData(): boolean;
    /** 索引是否为现代版（已预分析）；legacy 需走补分析路径 */
    isModern(): boolean;
    /** 当前端点标签（payload.registry） */
    endpointLabel(): string;
    /** 端点标签兜底（无胜出端点时用配置端点） */
    fallbackEndpointLabel(): string;
    /** 数据内容版本（内容哈希变化才递增，前端据此跳过无变化负载） */
    dataVersion: number;
    /** 修订号（每次 applyIndex / 补片广播递增，前端增量合并基准） */
    revision?: number;
    backgroundRunning(): boolean;
    backgroundTask(): Promise<void> | undefined;
    warmCacheTask(): Promise<boolean> | undefined;
    warmCache(reason: string): Promise<boolean>;
    /** 首次网络拉取任务（单飞；无则现场启动 collect） */
    prepareTask(): Promise<SearchResult | undefined>;
    /** 首载超时后注册"网络任务完成后触发一次刷新"的回调 */
    scheduleRefreshAfterPrepare(task: Promise<unknown>): void;
    /** 由 scanner 对象构建 name → SearchObject 字典 */
    buildData(): Dict<SearchObject>;
    /** 组装标准 payload（委托 assemblePayload） */
    buildPayload(): MarketSnapshotInput;
    failedCount(): number;
    scannerTotal(): number;
    scannerProgress(): number;
    /** 上次组装的 payload 缓存 */
    payload(): MarketSnapshotInput | undefined;
    setPayload(payload: MarketSnapshotInput): void;
    error(): unknown;
    /** 对外暴露的 debug 性能信息（logLevel=debug 才有值） */
    debugInfo(timings?: Dict<number>): MarketPerformance | undefined;
    log: { debug(message: string): void; info(message: string): void; warn(message: string): void };
}

/** getSnapshot 的 payload 结构：与 shared/types 的 MarketPayload 完全一致（fallow 重复报告驱动统一）。 */
export type MarketSnapshotInput = MarketPayload;

/** 后台任务运行中：复用数据源 payload 或组装 refreshing 快照。 */
function buildBackgroundPayload(
    host: SnapshotHost,
    start: number,
): MarketSnapshotInput | undefined {
    if (!host.backgroundRunning() || !host.hasCurrentData()) return;
    // 现代索引数据完备，直接重建标准 payload；
    // legacy 索引的补分析是渐进式的，沿用旧 payload 仅标记 refreshing，避免丢失进度
    if (host.isModern()) return host.buildPayload();
    const current = host.payload();
    return {
        ...(current ?? emptyPayload(host, start)),
        stale: false,
        error: undefined,
        refreshing: true,
        loading: false,
        dataVersion: host.dataVersion,
        revision: host.revision ?? 0,
        serverNow: Date.now(),
    };
}

/** 已有无错误 payload：刷新时间戳与调试信息后直接返回。 */
function buildCurrentPayload(host: SnapshotHost): MarketSnapshotInput | undefined {
    const current = host.payload();
    if (!current || host.error()) return;
    return {
        ...current,
        dataVersion: host.dataVersion,
        revision: host.revision ?? 0,
        serverNow: Date.now(),
        debug: host.debugInfo(),
    };
}

/** 首次加载：等待磁盘缓存预热任务（有 warm 任务则限时等待，否则直接触发预热）。 */
async function warmCacheForFirstPayload(host: SnapshotHost): Promise<boolean> {
    const warmTask = host.warmCacheTask();
    if (warmTask) return waitFor(warmTask, FIRST_PAYLOAD_TIMEOUT);
    return host.warmCache("first get").then(
        () => true,
        () => false,
    );
}

/** 首次网络等待：限时等待 prepareTask，返回是否就绪/已有数据。 */
async function waitForFirstPayload(
    host: SnapshotHost,
    task: Promise<SearchResult | undefined>,
    start: number,
): Promise<{ ready: boolean; hasData: boolean }> {
    const ready = await waitFor(task, Math.max(0, FIRST_PAYLOAD_TIMEOUT - (Date.now() - start)));
    const hasData = host.hasCurrentData();
    if (hasData) {
        host.log.debug(
            `return market payload after first-load wait, elapsed=${Date.now() - start}ms`,
        );
    }
    return { ready, hasData };
}

/** 加载失败降级：有旧 payload 则标记 stale 返回，否则返回空 payload + 错误信息。 */
function buildErrorPayload(host: SnapshotHost, start: number): MarketSnapshotInput {
    const error = host.error();
    const cachedPayload = host.payload();
    if (cachedPayload) {
        const message = formatError(error);
        host.log.warn(
            `market load failed; returning previous payload: total=${cachedPayload.total}, error=${message}`,
        );
        return {
            ...cachedPayload,
            stale: true,
            error: message,
            refreshing: false,
            loading: false,
            dataVersion: host.dataVersion,
            revision: host.revision ?? 0,
            serverNow: Date.now(),
            debug: host.debugInfo(),
        };
    }
    return {
        ...emptyPayload(host, start),
        error: formatError(error),
        refreshing: false,
        loading: false,
        debug: host.debugInfo(),
    };
}

/**
 * getSnapshot 快照组装：后台任务复用 → 缓存 payload → 磁盘缓存预热等待 →
 * 首次网络等待 → 错误降级。移植自旧 MarketProvider.getSnapshot/createPayload。
 */
export async function buildMarketSnapshot(host: SnapshotHost): Promise<MarketSnapshotInput> {
    const start = Date.now();
    const background = buildBackgroundPayload(host, start);
    if (background) return background;
    const current = buildCurrentPayload(host);
    if (current) return current;
    if (!host.hasCurrentData()) {
        const ready = await warmCacheForFirstPayload(host);
        if (ready && host.hasCurrentData()) return host.buildPayload();
    }
    const task = host.prepareTask();
    if (!host.hasCurrentData()) {
        const { ready, hasData } = await waitForFirstPayload(host, task, start);
        if (hasData) return host.buildPayload();
        if (!ready) {
            host.scheduleRefreshAfterPrepare(task);
            host.log.info(
                `market first payload still waiting for network: elapsed=${Date.now() - start}ms`,
            );
            return {
                ...emptyPayload(host, start),
                refreshing: true,
                loading: true,
                debug: host.debugInfo({ total: Date.now() - start }),
            };
        }
    } else {
        await task;
    }
    if (host.error()) return buildErrorPayload(host, start);
    return host.buildPayload();
}

/** 无数据/等待中状态的兜底空 payload 骨架（错误场景在其上叠加 error 字段）。 */
function emptyPayload(host: SnapshotHost, start: number): MarketSnapshotInput {
    return {
        registry: host.fallbackEndpointLabel(),
        data: {},
        failed: 0,
        total: 0,
        progress: 0,
        stale: false,
        error: undefined,
        cached: false,
        refreshing: false,
        loading: false,
        dataVersion: host.dataVersion,
        revision: host.revision ?? 0,
        serverNow: Date.now(),
        debug: host.debugInfo({ total: Date.now() - start }),
    };
}

/** 命中数据后的标准 payload 组装（createPayload）。 */
export function assemblePayload(
    host: SnapshotHost,
    options: { refreshing: boolean; cacheMeta?: CacheMetaView | undefined },
): MarketSnapshotInput {
    const payloadStart = Date.now();
    const dataStart = Date.now();
    const data = host.buildData();
    const dataElapsed = Date.now() - dataStart;
    const payload: MarketSnapshotInput = {
        registry: host.endpointLabel(),
        data,
        dataVersion: host.dataVersion,
        revision: host.revision ?? 0,
        failed: host.isModern() ? 0 : host.failedCount(),
        total: host.scannerTotal(),
        progress: host.isModern() ? host.scannerTotal() : host.scannerProgress(),
        gravatar: process.env["GRAVATAR_MIRROR"],
        stale: false,
        error: undefined,
        cached: !!options.cacheMeta,
        cachedAt: options.cacheMeta?.fetchedAt,
        validatedAt: options.cacheMeta?.validatedAt,
        serverNow: Date.now(),
        refreshing: options.refreshing,
        loading: false,
        debug: host.debugInfo({ payloadData: dataElapsed, payload: Date.now() - payloadStart }),
    };
    host.setPayload(payload);
    return payload;
}

/** assemblePayload 的缓存元数据视图：命中磁盘缓存时用于填充 cached/cachedAt/validatedAt。 */
export interface CacheMetaView {
    /** 缓存条目首次抓取时间戳 */
    fetchedAt?: number | undefined;
    /** 缓存条目最近校验时间戳 */
    validatedAt?: number | undefined;
}
