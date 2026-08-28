/**
 * @file 异步控制小工具(core/utils 域):sleep 与限时等待。被 core 各域用于
 * 轮询间隔、退避与"至多等这么久"的超时控制。纯逻辑,无外部 I/O 依赖。
 */

/** 睡眠指定毫秒数:退避、轮询间隔等场景的 Promise 化 setTimeout。 */
export function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** 等待一个任务至多 timeout 毫秒，超时返回 false（不拒绝）。 */
export async function waitFor(task: Promise<unknown>, timeout: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            task.then(() => true),
            new Promise<boolean>((resolve) => {
                timer = setTimeout(() => resolve(false), timeout);
            }),
        ]);
    } finally {
        // 无论胜负都要清掉定时器,避免超时分支的 timer 泄漏
        clearTimeout(timer);
    }
}
