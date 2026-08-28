/**
 * @file 市场索引后台刷新/探测编排(core/market/source 域)。
 *
 * 职责:refreshInBackground 在已有数据先上屏的前提下后台拉新
 * (cache-first/soft refresh 场景);probeInBackground 处理空闲探测 ——
 * 无数据时走全新探测(推进序号),有数据时退化为一次后台刷新。
 *
 * 关键设计:
 * - 同 serial 的后台任务去重(backgroundTask + backgroundSerial),
 *   避免 cache-first 与手动刷新同时触发两次网络;
 * - 任务结束统一在 finally 里 notifyRefresh(失败也通知,前端能看到错误);
 * - 序号过期(stale)的结果静默丢弃,不覆盖新一轮数据。
 */
import type { RequestScope } from "../../racing/request-scope.js";
import { formatError } from "../../utils/format.js";
import { formatSnapshot } from "../format.js";
import type { EndpointResult } from "../types.js";
import { performanceFrom } from "./host.js";

/** 后台刷新/探测编排所需的源视图（MarketIndexSource 结构性子集）。 */
export interface MarketBackgroundSource {
    readonly scope: RequestScope;
    readonly scanner: { total: number };
    readonly log: {
        debug(message: string): void;
        info(message: string): void;
        warn(message: string): void;
    };
    /** 进行中的后台任务与其序号(去重判定) */
    backgroundTask: Promise<void> | undefined;
    backgroundSerial: number | undefined;
    collectError: unknown;
    hasCurrentData(): boolean;
    fetchAndApply(
        serial: number,
        phase: "initial" | "refresh",
    ): Promise<EndpointResult | undefined>;
    notifyRefresh(): unknown;
    resetProbeState(): void;
}

/**
 * 市场索引后台刷新/探测编排。
 * 成块移植自旧 MarketProvider 的 refreshInBackground/probeInBackground 系列方法。
 */
export class MarketBackgroundRefresher {
    private readonly source: MarketBackgroundSource;

    constructor(source: MarketBackgroundSource) {
        this.source = source;
    }

    /**
     * 发起后台刷新:同一 serial 已有任务在跑则直接返回 false(去重)。
     * 任务结束(无论成败)清空登记并通知前端刷新。
     */
    refreshInBackground(serial: number, reason = "background") {
        const source = this.source;
        if (source.backgroundTask && source.backgroundSerial === serial) return false;
        const task = this.refreshIndexInBackground(serial).finally(() => {
            // 任务被更新的任务顶替时不清空别人的登记
            if (source.backgroundTask !== task) return;
            source.backgroundTask = undefined;
            source.backgroundSerial = undefined;
            void source.notifyRefresh();
        });
        source.backgroundTask = task;
        source.backgroundSerial = serial;
        void reason;
        return true;
    }

    /**
     * 空闲探测入口:已有后台任务则等它;无数据时推进序号做全新探测
     * (重置一次性状态);有数据则退化为同 serial 的后台刷新。
     */
    async probeInBackground(reason = "idle probe"): Promise<boolean> {
        const source = this.source;
        if (source.scope.isDisposed) return false;
        if (source.backgroundTask) {
            await source.backgroundTask;
            return true;
        }
        if (!source.hasCurrentData()) {
            // 无数据:必须真拉网络,推进序号让旧请求全部作废
            const serial = source.scope.current + 1;
            source.scope.advance(`${reason} market probe superseded`);
            return this.probeIndexInBackground(serial, reason);
        }
        const serial = source.scope.current;
        if (this.refreshInBackground(serial, reason)) {
            void source.notifyRefresh();
            await source.backgroundTask;
            return true;
        }
        return false;
    }

    /** 后台刷新主体:拉取 → 应用 → 通知;失败记录 collectError 并告警。 */
    private async refreshIndexInBackground(serial: number) {
        const source = this.source;
        const start = Date.now();
        try {
            const result = await source.fetchAndApply(serial, "refresh");
            if (source.scope.isStale(serial) || !result) return;
            await source.notifyRefresh();
            source.log.info(
                `background market refresh completed: ${formatSnapshot(performanceFrom(result, source.scanner.total))}, elapsed=${Date.now() - start}ms`,
            );
        } catch (error) {
            // 过期请求的失败不算错误:新一轮请求已接管
            if (source.scope.isStale(serial)) return;
            source.collectError = error;
            await source.notifyRefresh();
            source.log.warn(
                `background market refresh failed in ${Date.now() - start}ms: ${formatError(error)}`,
            );
        }
    }

    /** 全新探测主体:先重置一次性状态再拉取,结果与错误处理同后台刷新。 */
    private async probeIndexInBackground(serial: number, reason: string): Promise<boolean> {
        const source = this.source;
        const start = Date.now();
        source.resetProbeState();
        try {
            const result = await source.fetchAndApply(serial, "refresh");
            if (source.scope.isStale(serial)) return false;
            if (!result) return false;
            await source.notifyRefresh();
            source.log.info(`${reason} market probe completed, elapsed=${Date.now() - start}ms`);
            return true;
        } catch (error) {
            if (source.scope.isStale(serial)) return false;
            source.collectError = error;
            await source.notifyRefresh();
            source.log.warn(
                `${reason} market probe failed in ${Date.now() - start}ms: ${formatError(error)}`,
            );
            return false;
        }
    }
}
