/**
 * @file 端点学习型统计本(core/racing 域)。
 *
 * RouteStatsBook 按 policy 记录各端点的成功/失败/延迟并维护分数:
 * 成功加分(快慢两档)、失败按 policy 扣分并进入冷却阶梯(连续失败越多
 * 冷却越久);EWMA 平滑延迟。npm registry 与市场索引共用同一实现,
 * 差异(冷却策略、扣分力度、是否记失败元数据)全部由 StatsPolicy 注入。
 * 统计会被各域持久化(registry/stats-file、market cache 清单)并在重启后恢复。
 */
import { clamp } from "../utils/math.js";

/** 端点学习型统计：npm registry 与市场索引共用（字段为两者超集）。 */
export interface RouteStats {
    /** 路由分数(越高越优,clamp 区间由 policy 决定) */
    score: number;
    successes: number;
    failures: number;
    /** 连续失败次数(冷却阶梯的输入,成功清零) */
    consecutiveFailures?: number | undefined;
    /** EWMA 平均延迟(ms) */
    averageElapsed?: number | undefined;
    lastSuccess?: number | undefined;
    /** registry 专用 */
    lastFailure?: number | undefined;
    lastFailureReason?: string | undefined;
    /** 市场索引专用 */
    contentEncoding?: string | undefined;
    /** 冷却截止时间戳(冷却期内不参与竞速,主端点除外) */
    cooldownUntil?: number | undefined;
}

/** 记分策略:registry 与市场索引各注入一份,保持各自旧行为。 */
export interface StatsPolicy {
    /** elapsed <= fastThreshold 记 +0.4，否则 +0.1 */
    fastThreshold: number;
    /** 成功分数的 clamp 区间 */
    successClamp: readonly [number, number];
    /** 失败分数的 clamp 区间 */
    failureClamp: readonly [number, number];
    /** 失败扣分；rescue 模式（市场索引）不延长冷却 */
    failurePenalty: (options: {
        reason?: string | undefined;
        rescue?: boolean | undefined;
    }) => number;
    /** 连续失败 n 次后的冷却时长；返回 0 表示无冷却（registry） */
    cooldown: (consecutiveFailures: number) => number;
    /** registry 对 EWMA 取整，市场索引保留小数——保持各自旧行为 */
    roundAverage: boolean;
    /** registry 记录 lastFailure/lastFailureReason，市场索引不记 */
    trackFailureMeta: boolean;
}

/** 端点统计本:端点 → RouteStats,按 policy 记分。 */
export class RouteStatsBook {
    readonly stats: Record<string, RouteStats> = {};
    private readonly policy: StatsPolicy;

    constructor(policy: StatsPolicy) {
        this.policy = policy;
    }

    get(endpoint: string): RouteStats | undefined {
        return this.stats[endpoint];
    }

    /**
     * 记录一次成功:清零连续失败与冷却,历史失败数按 0.6 衰减
     * (近期表现权重更高),分数按快/慢两档加分,延迟做 EWMA(0.7 旧 + 0.3 新)。
     */
    recordSuccess(
        endpoint: string,
        elapsed: number,
        options: { contentEncoding?: string | undefined } = {},
    ) {
        let stats = this.stats[endpoint];
        if (!stats) {
            stats = { score: 0, successes: 0, failures: 0 };
            this.stats[endpoint] = stats;
        }
        stats.successes++;
        stats.consecutiveFailures = 0;
        stats.cooldownUntil = undefined;
        stats.failures = Math.max(0, Math.floor(stats.failures * 0.6));
        stats.score = clamp(
            stats.score + (elapsed <= this.policy.fastThreshold ? 0.4 : 0.1),
            this.policy.successClamp[0],
            this.policy.successClamp[1],
        );
        stats.lastSuccess = Date.now();
        if (options.contentEncoding !== undefined) stats.contentEncoding = options.contentEncoding;
        stats.averageElapsed =
            stats.averageElapsed == null
                ? elapsed
                : this.policy.roundAverage
                  ? Math.round(stats.averageElapsed * 0.7 + elapsed * 0.3)
                  : stats.averageElapsed * 0.7 + elapsed * 0.3;
        return stats;
    }

    /**
     * 记录一次失败:rescue 模式(市场索引救援)只扣分不累计冷却 ——
     * 救援端点本来就在冷却中,不该被二次加时;普通失败累计连续失败、
     * 按 policy 阶梯设置冷却并扣分。
     */
    recordFailure(
        endpoint: string,
        options: { reason?: string | undefined; rescue?: boolean | undefined } = {},
    ) {
        let stats = this.stats[endpoint];
        if (!stats) {
            stats = { score: 0, successes: 0, failures: 0 };
            this.stats[endpoint] = stats;
        }
        stats.failures++;
        if (options.rescue) {
            stats.score = clamp(
                stats.score - this.policy.failurePenalty({ rescue: true }),
                this.policy.failureClamp[0],
                this.policy.failureClamp[1],
            );
        } else {
            stats.consecutiveFailures = (stats.consecutiveFailures ?? 0) + 1;
            const cooldown = this.policy.cooldown(stats.consecutiveFailures);
            if (cooldown > 0) stats.cooldownUntil = Date.now() + cooldown;
            stats.score = clamp(
                stats.score - this.policy.failurePenalty({ reason: options.reason }),
                this.policy.failureClamp[0],
                this.policy.failureClamp[1],
            );
        }
        if (this.policy.trackFailureMeta) {
            stats.lastFailure = Date.now();
            stats.lastFailureReason = options.reason;
        }
        return stats;
    }

    /** registry：端点切换时整体作废学习数据。 */
    reset() {
        for (const key of Object.keys(this.stats)) delete this.stats[key];
    }
}
