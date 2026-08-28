/**
 * 竞速请求的失效域：serial 陈旧性检查 + AbortController 生命周期。
 * 成块移植自旧 Installer/MarketProvider 中两份相同的实现，算法未改。
 */
export class RequestScope {
    private serialValue = 0;
    private disposed = false;
    private readonly controllers = new Set<AbortController>();

    private readonly options: { isActive?: () => boolean };

    constructor(options: { isActive?: () => boolean } = {}) {
        this.options = options;
    }

    get current(): number {
        return this.serialValue;
    }

    get isDisposed(): boolean {
        return this.disposed;
    }

    /** 使现存请求全部失效（新的全量刷新/探测开始前调用）。 */
    advance(reason: string) {
        this.serialValue++;
        this.abortPending(reason);
    }

    isStale(serial: number) {
        return this.disposed || serial !== this.serialValue || this.options.isActive?.() === false;
    }

    dispose(reason: string) {
        this.disposed = true;
        this.serialValue++;
        this.abortPending(reason);
    }

    track(controller: AbortController) {
        this.controllers.add(controller);
        return controller;
    }

    untrack(controllers: AbortController[]) {
        for (const controller of controllers) {
            this.controllers.delete(controller);
        }
    }

    abortPending(reason: string) {
        for (const controller of this.controllers) {
            controller.abort(new Error(reason));
        }
        this.controllers.clear();
    }
}

/** 竞速内部的主动取消（结算/过期/销毁），不应计入端点失败。 */
export function isInternalAbort(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return /race settled|stale|disposed|aborted|abort/i.test(message);
}
