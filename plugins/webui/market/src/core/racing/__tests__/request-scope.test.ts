import { describe, expect, it } from "vitest";
import { isInternalAbort, RequestScope } from "../request-scope.js";

describe("RequestScope", () => {
    it("current 从 0 开始", () => {
        expect(new RequestScope().current).toBe(0);
        expect(new RequestScope().isDisposed).toBe(false);
    });

    it("advance 使旧 serial 失效并中止挂起控制器", () => {
        const scope = new RequestScope();
        const controller = scope.track(new AbortController());
        expect(scope.isStale(scope.current)).toBe(false);
        scope.advance("superseded");
        expect(controller.signal.aborted).toBe(true);
        expect(controller.signal.reason).toBeInstanceOf(Error);
        expect(scope.isStale(0)).toBe(true);
        expect(scope.isStale(scope.current)).toBe(false);
    });

    it("untrack 后不再受 advance 影响", () => {
        const scope = new RequestScope();
        const controller = new AbortController();
        scope.track(controller);
        scope.untrack([controller]);
        scope.advance("x");
        expect(controller.signal.aborted).toBe(false);
    });

    it("dispose 使全部请求失效", () => {
        const scope = new RequestScope();
        const controller = scope.track(new AbortController());
        const serial = scope.current;
        scope.dispose("shutdown");
        expect(scope.isDisposed).toBe(true);
        expect(scope.isStale(serial)).toBe(true);
        expect(controller.signal.aborted).toBe(true);
    });

    it("isActive 返回 false 时视为陈旧", () => {
        const scope = new RequestScope({ isActive: () => false });
        expect(scope.isStale(scope.current)).toBe(true);
    });

    it("track 的控制器在 abortPending 时被清空", () => {
        const scope = new RequestScope();
        const controller = scope.track(new AbortController());
        scope.abortPending("cleanup");
        expect(controller.signal.aborted).toBe(true);
    });
});

describe("isInternalAbort", () => {
    it("识别内部取消错误", () => {
        expect(isInternalAbort(new Error("race settled"))).toBe(true);
        expect(isInternalAbort(new Error("request stale"))).toBe(true);
        expect(isInternalAbort(new Error("provider disposed"))).toBe(true);
        expect(isInternalAbort(new Error("AbortError: aborted"))).toBe(true);
        expect(isInternalAbort(new Error("boom"))).toBe(false);
        expect(isInternalAbort("boom")).toBe(false);
    });
});
