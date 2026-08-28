import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KoishiClientStub } from "../../__tests__/helpers";

/**
 * @file ensure.ts 的单元测试:配置节点就绪等待。
 *
 * 轮询等待(40×250ms)用 fake timers 推进,覆盖:服务端 ensure-config 的
 * 成功/拒绝、包落库轮询的命中与超时、configWriter.ensure 兜底、
 * 入参短路(空名/未装 config 插件)与批量并行入口。
 */

vi.mock("@koishi-ce/client", async () => {
	const { createKoishiClientStub } = await import("../../__tests__/helpers");
	return createKoishiClientStub();
});

// vi.mock 只是运行时替换,tsc 仍按真实模块类型推导;统一断言为桩视图
const { send, store } = (await import(
	"@koishi-ce/client"
)) as unknown as KoishiClientStub;
const { ensureInstalledConfig, ensureInstalledConfigs } = await import(
	"../ensure"
);

/** 构造 ctx:返回带 spy 的 configWriter。 */
function createContext() {
	const writer = {
		get: vi.fn().mockReturnValue([]),
		ensure: vi.fn(),
		remove: vi.fn(),
	};
	return { ctx: { get: () => writer } as any, writer };
}

beforeEach(() => {
	vi.useFakeTimers();
	send.mockReset();
	store.packages = {};
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("ensureInstalledConfig", () => {
	it("空包名或未装 config 插件时直接返回,不发 RPC 不兜底", async () => {
		const { ctx, writer } = createContext();
		await ensureInstalledConfig(ctx, "");
		await ensureInstalledConfig({ get: () => undefined } as any, "pkg-a");
		expect(send).not.toHaveBeenCalled();
		expect(writer.ensure).not.toHaveBeenCalled();
	});

	it("包已落库且配置节点已就绪时不走兜底", async () => {
		send.mockResolvedValue(true);
		const { ctx, writer } = createContext();
		store.packages["pkg-a"] = { package: {} };
		writer.get.mockReturnValue([{ path: "plugins.a" }]);
		await ensureInstalledConfig(ctx, "pkg-a");
		expect(writer.ensure).not.toHaveBeenCalled();
		expect(send).toHaveBeenCalledWith("market/ensure-config", "pkg-a");
	});

	it("两轮轮询都超时(各 10s):configWriter.ensure 兜底建空配置", async () => {
		send.mockResolvedValue(true);
		const { ctx, writer } = createContext();
		const pending = ensureInstalledConfig(ctx, "pkg-a");
		await vi.advanceTimersByTimeAsync(21000);
		expect(await pending).toBeUndefined();
		expect(writer.get).toHaveBeenCalledWith("pkg-a");
		expect(writer.ensure).toHaveBeenCalledWith("pkg-a", true);
	});

	it("兜底支持显式非静默(silent=false)", async () => {
		send.mockResolvedValue(true);
		const { ctx, writer } = createContext();
		const pending = ensureInstalledConfig(ctx, "pkg-a", false);
		await vi.advanceTimersByTimeAsync(21000);
		await pending;
		expect(writer.ensure).toHaveBeenCalledWith("pkg-a", false);
	});

	it("等待期间包落库、配置节点出现时提前返回", async () => {
		send.mockResolvedValue(true);
		const { ctx, writer } = createContext();
		setTimeout(() => {
			store.packages["pkg-a"] = { package: {} };
			writer.get.mockReturnValue([{ path: "plugins.a" }]);
		}, 600);
		const pending = ensureInstalledConfig(ctx, "pkg-a");
		await vi.advanceTimersByTimeAsync(1000);
		await pending;
		expect(writer.ensure).not.toHaveBeenCalled();
	});

	it("ensure-config RPC 失败只告警,仍继续等待", async () => {
		send.mockRejectedValue(new Error("rpc down"));
		const { ctx, writer } = createContext();
		const pending = ensureInstalledConfig(ctx, "pkg-a");
		await vi.advanceTimersByTimeAsync(21000);
		await pending;
		expect(console.error).toHaveBeenCalled();
		expect(writer.ensure).toHaveBeenCalled();
	});

	it("轮询超时后 configWriter 服务消失时不再兜底", async () => {
		send.mockResolvedValue(true);
		const writer = {
			get: vi.fn().mockReturnValue([]),
			ensure: vi.fn(),
			remove: vi.fn(),
		};
		let calls = 0;
		const ctx = { get: () => (calls++ === 0 ? writer : undefined) } as any;
		const pending = ensureInstalledConfig(ctx, "pkg-a");
		await vi.advanceTimersByTimeAsync(21000);
		await pending;
		expect(writer.ensure).not.toHaveBeenCalled();
	});

	it("ensure-config 无任务返回(send 为 undefined)时也不影响流程", async () => {
		send.mockReturnValue(undefined);
		const { ctx, writer } = createContext();
		const pending = ensureInstalledConfig(ctx, "pkg-a");
		await vi.advanceTimersByTimeAsync(21000);
		await pending;
		expect(writer.ensure).toHaveBeenCalled();
	});
});

describe("ensureInstalledConfigs", () => {
	it("并行等待一组插件,逐个兜底", async () => {
		send.mockResolvedValue(true);
		const { ctx, writer } = createContext();
		const pending = ensureInstalledConfigs(ctx, ["pkg-a", "pkg-b"]);
		await vi.advanceTimersByTimeAsync(21000);
		await pending;
		expect(writer.ensure).toHaveBeenCalledWith("pkg-a", true);
		expect(writer.ensure).toHaveBeenCalledWith("pkg-b", true);
	});
});
