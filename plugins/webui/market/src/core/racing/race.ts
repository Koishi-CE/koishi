import { isInternalAbort, type RequestScope } from "./request-scope.js";

export interface RaceAttempt<T> {
    endpoint: string;
    payload: T;
    elapsed: number;
    fallbackReason?: "primary-failed" | "primary-slow" | undefined;
}

export interface RaceParams<T> {
    /** 候选端点，[0] 为主端点 */
    endpoints: string[];
    /** fallback 错峰间隔：第 i 个 fallback 延迟 i * stagger 后发起 */
    stagger: number;
    /** 主端点超过该耗时仍未返回时，以 primary-slow 启动 fallback 竞速 */
    slowThreshold: number;
    scope: RequestScope;
    serial: number;
    /** 实际请求；elapsed 从请求发起（含排队后）计时 */
    fetch: (endpoint: string, signal: AbortSignal) => Promise<{ payload: T; elapsed: number }>;
    onAttempt?: (endpoint: string) => void;
    /** 竞速胜出时记录（对应旧 recordRouteSuccess），已排除 stale/内部取消 */
    onSuccess: (attempt: RaceAttempt<T>) => void;
    /** 单个端点失败时记录（对应旧 recordRouteFailure），已排除 stale/内部取消 */
    onFailure: (endpoint: string, error: unknown) => void;
    /** 内部过程日志（debug 级） */
    log?: (message: string) => void;
}

/**
 * 多端点错峰竞速骨架：主端点先行，慢阈值或主端点失败后 fallback 依次错峰加入，
 * 任一成功即结算并中止其余请求；全部失败抛出最后一个错误。
 * 算法成块移植自旧 Installer.raceEndpoints 与 MarketProvider.fetchIndexFromEndpoints
 * （两份实现逐字等价，此处合并）。
 */
export function raceEndpoints<T>(params: RaceParams<T>): Promise<RaceAttempt<T>> {
    const {
        endpoints,
        scope,
        serial,
        stagger,
        slowThreshold,
        fetch,
        onAttempt,
        onSuccess,
        onFailure,
        log,
    } = params;
    const logOrNull = log ?? (() => {});

    const controller = scope.track(new AbortController());
    if (endpoints.length === 1) {
        onAttempt?.(endpoints[0]!);
        return fetch(endpoints[0]!, controller.signal)
            .then((result) => {
                const attempt: RaceAttempt<T> = { endpoint: endpoints[0]!, ...result };
                onSuccess(attempt);
                return attempt;
            })
            .catch((error: unknown) => {
                if (!scope.isStale(serial) && !isInternalAbort(error)) {
                    onFailure(endpoints[0]!, error);
                }
                throw error;
            })
            .finally(() => scope.untrack([controller]));
    }

    return new Promise<RaceAttempt<T>>((resolve, reject) => {
        let settled = false;
        let failed = 0;
        let lastError: unknown;
        let fallbackStarted = false;
        let fallbackReason: "primary-failed" | "primary-slow" | undefined;
        const controllers = endpoints.map(() => scope.track(new AbortController()));
        const timer = setTimeout(() => startFallback("primary-slow"), slowThreshold);

        const finish = () => {
            clearTimeout(timer);
            scope.untrack(controllers);
        };

        const settle = (result: { payload: T; elapsed: number }, index: number) => {
            if (settled) {
                logOrNull(
                    `ignore slower endpoint ${endpoints[index]}: elapsed=${result.elapsed}ms`,
                );
                return;
            }
            settled = true;
            finish();
            controllers.forEach((item, itemIndex) => {
                if (itemIndex !== index) item.abort(new Error("race settled"));
            });
            const attempt: RaceAttempt<T> = {
                endpoint: endpoints[index]!,
                ...result,
            };
            if (index !== 0) attempt.fallbackReason = fallbackReason;
            onSuccess(attempt);
            resolve(attempt);
        };

        const fail = (endpoint: string, index: number, error: unknown) => {
            if (settled) return;
            if (scope.isStale(serial) || isInternalAbort(error)) {
                settled = true;
                controllers.forEach((item) => {
                    item.abort(new Error("endpoint race cancelled"));
                });
                finish();
                reject(error);
                return;
            }
            onFailure(endpoint, error);
            lastError = error;
            if (index === 0) startFallback("primary-failed");
            if (++failed < endpoints.length) return;
            settled = true;
            finish();
            logOrNull(`all endpoint candidates failed: count=${endpoints.length}`);
            reject(lastError);
        };

        const startEndpoint = (endpoint: string, index: number, waitIndex = 0) => {
            const signal = controllers[index]!.signal;
            waitRouteTurn(waitIndex, stagger, signal)
                .then(() => {
                    if (settled) throw new Error("race settled before request");
                    onAttempt?.(endpoint);
                    return fetch(endpoint, signal);
                })
                .then((result) => settle(result, index))
                .catch((error: unknown) => fail(endpoint, index, error));
        };

        const startFallback = (reason: "primary-failed" | "primary-slow") => {
            if (settled || fallbackStarted) return;
            fallbackStarted = true;
            fallbackReason = reason;
            logOrNull(
                `fallback endpoint race started: reason=${reason}, count=${endpoints.length - 1}, stagger=${stagger}ms`,
            );
            endpoints.slice(1).forEach((endpoint, fallbackIndex) => {
                startEndpoint(endpoint, fallbackIndex + 1, fallbackIndex);
            });
        };

        startEndpoint(endpoints[0]!, 0);
    });
}

function waitRouteTurn(index: number, stagger: number, signal?: AbortSignal) {
    if (!index) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason);
        const timer = setTimeout(resolve, index * stagger);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(signal.reason);
            },
            { once: true },
        );
    });
}
