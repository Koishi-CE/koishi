/**
 * @file 空闲后台探测调度器(market 域)。
 *
 * 模块职责:
 * - setupIdleProbe:Console 无客户端连接时,按 boot 延迟/空闲延迟/间隔
 *   三重门控周期性触发"依赖探测 + 市场数据探测",让数据在无人使用时
 *   悄悄保持新鲜。
 *
 * 关键设计:
 * - 只在无 Console 连接时运行:探测会打 registry 与市场源,不能和用户
 *   操作抢带宽/并发;连接数从有变无时重新进入调度,从无变有立即取消;
 * - 门控全部用"时间差换算需等待多久"而非定时重排:getProbeWait 汇总
 *   boot 延迟、失败重试窗口(5 分钟或间隔取小)、成功间隔三类约束;
 * - 安装进行中(isInstalling)让路并按空闲延迟重排;探测任务本身
 *   Promise.allSettled 并行,任一成功即算本轮成功。
 *
 * 架构位置:node 适配层 market 模块,由 setup.ts 在插件启动时挂载;
 * 实际探测动作分别在 ctx.installer(依赖)与 console market 服务(市场)。
 */
import { type Context, Time } from "@koishi-ce/koishi";
import type { Config } from "../config/index.js";

/** 空闲后台探测：Console 无连接且满足 boot/delay/interval 门控时刷新依赖与市场数据。 */
export function setupIdleProbe(ctx: Context, config: Config) {
    if (config.idleProbe === false) return;

    const logger = ctx.logger("market");
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** 探测互斥:上一轮没跑完时不叠加新一轮。 */
    let running = false;
    /** 上次成功探测时间(0 = 尚未成功过),成功间隔从此起算。 */
    let lastProbe = 0;
    /** 上次失败时间(0 = 未失败),失败重试窗口从此起算。 */
    let lastFailure = 0;

    /** 当前 Console 连接数:>0 表示有人在用,探测应取消。 */
    const getClientCount = () => {
        const clients = ctx.console.clients as unknown;
        if (!clients) return 0;
        return Object.keys(clients).length;
    };
    const clearIdleTimer = () => {
        clearTimeout(timer);
        timer = undefined;
    };
    const getDelay = () => Math.max(0, config.idleProbeDelay ?? Time.minute * 5);
    const getBootDelay = () => Math.max(0, config.idleProbeBootDelay ?? Time.minute);
    const getInterval = () => Math.max(0, config.idleProbeInterval ?? Time.hour * 6);

    /** 调度下一轮探测:重排前先清旧定时器;插件已停、配置关闭或有连接时不再排。 */
    const schedule = (delay = getDelay()) => {
        clearIdleTimer();
        if (!ctx.scope.isActive || config.idleProbe === false) return;
        if (getClientCount()) return;
        timer = setTimeout(() => void runProbe(), Math.max(0, delay));
        logger.debug(`idle background probe scheduled: delay=${Math.max(0, delay)}ms`);
    };

    /** 计算需要延后调度的时间：boot 延迟 / 失败重试间隔 / 成功间隔，无需延后时返回 undefined。 */
    const getProbeWait = (): number | undefined => {
        const bootWait = getBootDelay() - (Date.now() - startedAt);
        if (bootWait > 0) return bootWait;
        const retryWait = lastFailure
            ? Math.min(Time.minute * 5, getInterval()) - (Date.now() - lastFailure)
            : 0;
        // 重试窗口只约束"从未成功过"的阶段;成功过则统一按成功间隔调度
        if (!lastProbe && retryWait > 0) return retryWait;
        const intervalWait = lastProbe ? getInterval() - (Date.now() - lastProbe) : 0;
        if (intervalWait > 0) return intervalWait;
        return undefined;
    };

    /** 并行跑依赖与市场两组探测:任一成功即算成功;market 探测返回 false 也算失败。 */
    const runProbeTasks = async (): Promise<{ succeeded: boolean; reason?: unknown }> => {
        const [depsResult, marketResult] = await Promise.allSettled([
            ctx.installer.probeDependenciesInBackground("idle").then(() => true),
            ctx.console.services.market?.probeInBackground?.("idle probe") ??
                Promise.resolve(false),
        ]);
        const succeeded =
            (depsResult.status === "fulfilled" && depsResult.value === true) ||
            (marketResult.status === "fulfilled" && marketResult.value !== false);
        if (succeeded) return { succeeded };
        const reason =
            depsResult.status === "rejected"
                ? depsResult.reason
                : marketResult.status === "rejected"
                  ? marketResult.reason
                  : "no probe result";
        return { succeeded, reason };
    };

    /** 记录探测结果:成功刷新 lastProbe 并清失败标记,失败只记 lastFailure 供重试换算。 */
    const handleProbeOutcome = (
        outcome: { succeeded: boolean; reason?: unknown },
        probeStartedAt: number,
    ) => {
        if (outcome.succeeded) {
            lastProbe = Date.now();
            lastFailure = 0;
            logger.info(
                `idle background probe completed: elapsed=${Date.now() - probeStartedAt}ms`,
            );
        } else {
            lastFailure = Date.now();
            logger.warn(
                `idle background probe failed: ${outcome.reason instanceof Error ? outcome.reason.message : outcome.reason}`,
            );
        }
    };

    /** 定时器到点后的执行体:过门控后真正跑探测,收尾时按结果排下一轮。 */
    const runProbe = async () => {
        clearIdleTimer();
        if (!ctx.scope.isActive) return;
        if (getClientCount()) return;
        if (ctx.installer.isInstalling) {
            logger.debug("skip idle background probe because dependency install is active");
            schedule(getDelay());
            return;
        }
        const wait = getProbeWait();
        if (wait !== undefined) {
            schedule(wait);
            return;
        }
        if (running) return;

        running = true;
        const probeStartedAt = Date.now();
        try {
            handleProbeOutcome(await runProbeTasks(), probeStartedAt);
        } catch (error) {
            lastFailure = Date.now();
            logger.warn(
                `idle background probe failed: ${error instanceof Error ? error.message : error}`,
            );
        } finally {
            running = false;
            // 无人连接才续排:成功过按完整间隔,否则按短重试窗口(5 分钟与间隔取小)
            if (!getClientCount())
                schedule(lastProbe ? getInterval() : Math.min(Time.minute * 5, getInterval()));
        }
    };

    // 连接数每次变化都重新评估:有人连上立即取消,全部断开则恢复调度
    ctx.on("console/connection", () => {
        if (getClientCount()) {
            clearIdleTimer();
            logger.debug(`idle background probe cancelled: clients=${getClientCount()}`);
        } else {
            schedule();
        }
    });

    // 宿主 ready 后启动首轮调度:至少等到空闲延迟与 boot 延迟的较大者
    ctx.on("ready", () => {
        if (!getClientCount()) schedule(Math.max(getDelay(), getBootDelay()));
    });

    // 插件停用时清掉未触发的定时器
    ctx.effect(() => () => clearIdleTimer());
}
