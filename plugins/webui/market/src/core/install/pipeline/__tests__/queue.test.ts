import { describe, expect, it, vi } from "vitest";
import type { InstallLogger } from "../../types.js";
import { InstallQueue } from "../queue.js";

function makeLogger() {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    } satisfies InstallLogger;
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("InstallQueue", () => {
    it("withLock 串行执行并传递返回值", async () => {
        const queue = new InstallQueue(makeLogger());
        const order: string[] = [];
        const first = queue.withLock("a", async () => {
            order.push("start-a");
            await sleep(10);
            order.push("end-a");
            return 1;
        });
        const second = queue.withLock("b", async () => {
            order.push("b");
            return 2;
        });
        expect(await first).toBe(1);
        expect(await second).toBe(2);
        expect(order).toEqual(["start-a", "end-a", "b"]);
    });

    it("isInstalling 在回调执行期间为 true", async () => {
        const queue = new InstallQueue(makeLogger());
        let seen: boolean | undefined;
        await queue.withLock("a", async () => {
            seen = queue.isInstalling;
            return undefined;
        });
        expect(seen).toBe(true);
        expect(queue.isInstalling).toBe(false);
    });

    it("排队中的任务记录 info 日志", async () => {
        const logger = makeLogger();
        const queue = new InstallQueue(logger);
        let entered!: () => void;
        const enteredPromise = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const first = queue.withLock("a", async () => {
            entered();
            await sleep(10);
            return undefined;
        });
        await enteredPromise; // 等待第一个回调真正运行（installActive = true）
        await queue.withLock("b", async () => undefined);
        await first;
        expect(logger.info).toHaveBeenCalledWith("dependency install queued: b");
    });

    it("回调抛错时释放锁", async () => {
        const queue = new InstallQueue(makeLogger());
        await expect(
            queue.withLock("a", async () => {
                throw new Error("boom");
            }),
        ).rejects.toThrow("boom");
        expect(queue.isInstalling).toBe(false);
        // 锁释放后后续任务可正常执行
        await expect(queue.withLock("b", async () => 42)).resolves.toBe(42);
    });
});
