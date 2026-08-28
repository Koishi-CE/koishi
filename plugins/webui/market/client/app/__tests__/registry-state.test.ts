import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * @file registry 推送接收/微批合并/超时清扫的行为测试(app 域)。
 *
 * 覆盖:50ms 微批窗口内多路推送合并成一次原地应用(未到窗口不生效)、
 * 同包后到的状态覆盖先到的、registry-status/clear 丢弃未应用缓冲、
 * 超时 loading 条目的 sweep 收敛与新鲜条目的豁免。
 */

vi.mock("@koishi-ce/client", async () => {
    const { createKoishiClientStub } = await import("../../shared/__tests__/helpers");
    return createKoishiClientStub();
});

vi.mock("../../shared/i18n", () => ({
    translate: (key: string) => key,
}));

const client = (await import("@koishi-ce/client")) as any;
const { getReceiveCallback } = await import("../../shared/__tests__/helpers");
const { sweepRegistryStatus } = await import("../registry-state");

function emitRegistry(data: Record<string, any>) {
    getReceiveCallback(client.receive, "market/registry")(data);
}

function emitStatus(data: Record<string, any>) {
    getReceiveCallback(client.receive, "market/registry-status")(data);
}

function emitClear() {
    getReceiveCallback(client.receive, "market/registry-status/clear")();
}

beforeEach(() => {
    vi.useFakeTimers();
    client.store.registry = {};
    client.store.registryStatus = undefined;
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
});

describe("registry 推送微批合并", () => {
    it("短窗内多包推送合并成一次应用,未到窗口不生效", () => {
        emitRegistry({ "pkg-a": { "1.0.0": {} } });
        emitRegistry({ "pkg-b": { "2.0.0": {} } });
        expect(client.store.registry).toEqual({});

        vi.advanceTimersByTime(50);
        expect(client.store.registry["pkg-a"]).toEqual({ "1.0.0": {} });
        expect(client.store.registry["pkg-b"]).toEqual({ "2.0.0": {} });
    });

    it("同包后到的状态覆盖先到的", () => {
        emitStatus({ "pkg-a": { loading: true, updatedAt: 1 } });
        emitStatus({ "pkg-a": { loading: false, reason: "ok" } });
        vi.advanceTimersByTime(50);

        expect(client.store.registryStatus["pkg-a"]).toEqual({ loading: false, reason: "ok" });
    });

    it("clear 丢弃未应用的缓冲", () => {
        emitRegistry({ "pkg-a": { "1.0.0": {} } });
        emitStatus({ "pkg-a": { loading: true, updatedAt: 1 } });
        emitClear();
        vi.advanceTimersByTime(100);

        expect(client.store.registry["pkg-a"]).toBeUndefined();
        expect(client.store.registryStatus).toEqual({});
    });
});

describe("拉取状态超时清扫", () => {
    it("超过两分钟的 loading 条目收敛为 timeout 终态", () => {
        client.store.registryStatus = { "pkg-a": { loading: true, updatedAt: 1, endpoint: "https://registry.npmmirror.com" } };

        expect(sweepRegistryStatus(client.store)).toBe(true);
        expect(client.store.registryStatus["pkg-a"]).toMatchObject({
            loading: false,
            reason: "timeout",
            error: "common.messages.metadataTimeout",
            endpoint: "https://registry.npmmirror.com",
        });
    });

    it("新鲜 loading 条目不被清扫", () => {
        client.store.registryStatus = { "pkg-b": { loading: true, updatedAt: Date.now() } };

        expect(sweepRegistryStatus(client.store)).toBe(false);
        expect(client.store.registryStatus["pkg-b"].loading).toBe(true);
    });
});
