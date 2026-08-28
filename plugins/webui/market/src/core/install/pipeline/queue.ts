/**
 * @file 安装串行队列(core/install/pipeline 域)。
 *
 * 职责:把所有会改写宿主依赖的操作(安装、环境恢复)串成一条 promise 链,
 * 同一时刻只有一个在跑,其余排队等待。避免并发安装互相踩 package.json
 * 与包管理器锁文件。
 *
 * 架构位置:由 InstallOrchestrator 持有,install() 入口先过 withLock 再进
 * 执行器;node 层通过 isInstalling 感知当前是否有安装在跑。
 */
import type { InstallLogger } from "../types.js";

/** 安装串行锁：保证同一时刻只有一个安装/环境恢复在跑，其余排队。 */
export class InstallQueue {
    /** 队尾 promise:新任务 await 它即可排到队尾 */
    private installTask = Promise.resolve();
    /** 是否有任务正在执行(排队中不算) */
    private installActive = false;
    private readonly log: InstallLogger;

    constructor(log: InstallLogger) {
        this.log = log;
    }

    /** 当前是否有安装任务在执行(不含排队等待的)。 */
    get isInstalling() {
        return this.installActive;
    }

    /**
     * 在串行锁内执行 callback:先把队尾换成新 promise(await previous 排队),
     * 再独占执行。finally 里释放锁,异常也会放行后续排队任务。
     */
    async withLock<T>(description: string, callback: () => Promise<T>): Promise<T> {
        const previous = this.installTask;
        let release: () => void = () => {};
        this.installTask = new Promise<void>((resolve) => {
            release = resolve;
        });
        if (this.installActive) this.log.info(`dependency install queued: ${description}`);
        await previous;
        this.installActive = true;
        try {
            return await callback();
        } finally {
            this.installActive = false;
            release();
        }
    }
}
