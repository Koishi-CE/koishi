import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import type { KoishiClientStub } from "../../__tests__/helpers";

/**
 * @file install() 断连竞态与等待日志的单元测试。
 *
 * 以可编程的 socket ref 触发 vue watch,验证:非自更新断连按失败、
 * allowDisconnectSuccess 逃生门、自更新断连跳过 callback、断连后的
 * 回调异常只告警、8 秒未响应追加"仍在等待"日志(fake timers)。
 */

vi.mock("@koishi-ce/client", async () => {
	const { createKoishiClientStub } = await import("../../__tests__/helpers");
	return createKoishiClientStub();
});

const i18nMock = vi.hoisted(() => ({
	translate: vi.fn((key: string, params?: any) =>
		params ? `${key}:${JSON.stringify(params)}` : key,
	),
}));

vi.mock("../../i18n", () => ({ translate: i18nMock.translate }));

// vi.mock 只是运行时替换,tsc 仍按真实模块类型推导;统一断言为桩视图
const { message, send, socket } = (await import(
	"@koishi-ce/client"
)) as unknown as KoishiClientStub;
const { installProgressState, resetInstallFallbackState } = await import(
	"../progress"
);
const { MARKET_NEXT_PACKAGE } = await import("../state");
const { install } = await import("../install");

beforeEach(() => {
	send.mockReset();
	message.error.mockReset();
	message.warning.mockReset();
	message.success.mockReset();
	i18nMock.translate.mockClear();
	socket.value = "ws://live";
	installProgressState.status = "idle";
	installProgressState.logs = [];
	resetInstallFallbackState();
	vi.spyOn(console, "warn").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

/** 构造挂起的安装任务与手动 resolve 句柄。 */
function pendingTask() {
	let resolve!: (code: number) => void;
	const task = new Promise<number>((res) => (resolve = res));
	send.mockImplementation((event: string) =>
		event === "market/install" ? task : Promise.resolve(undefined),
	);
	return { resolve };
}

/** 触发 socket 断连并等待 vue watch 生效。 */
async function disconnect() {
	socket.value = null;
	await nextTick();
	await nextTick();
}

describe("install 断连竞态", () => {
	// 源码现状:install 未透传 runInstall 的返回码(疑似 bug,见汇报),
	// 成败一律以面板状态与 toast 断言。
	it("非自更新断连:按失败处理,弹 warning", async () => {
		const { resolve } = pendingTask();
		const callback = vi.fn();
		const pending = install({ "pkg-a": "^1.0.0" }, callback);
		await disconnect();
		resolve(0);
		expect(await pending).toBeUndefined();
		expect(installProgressState.status).toBe("error");
		expect(callback).not.toHaveBeenCalled();
		expect(message.warning).toHaveBeenCalledWith(
			"operations.progress.disconnectedShort",
		);
		expect(
			installProgressState.logs.some(
				({ line }) => line === "operations.progress.disconnected",
			),
		).toBe(true);
	});

	it("allowDisconnectSuccess:普通安装断连也按成功收尾", async () => {
		const { resolve } = pendingTask();
		const callback = vi.fn();
		const pending = install({}, callback, false, {
			allowDisconnectSuccess: true,
		});
		await disconnect();
		resolve(0);
		await pending;
		expect(callback).toHaveBeenCalledOnce();
		expect(message.success).toHaveBeenCalledWith(
			"operations.progress.dependenciesSubmittedSuccess",
		);
	});

	it("自更新断连:默认跳过 callback,弹已提交成功 toast", async () => {
		const { resolve } = pendingTask();
		const callback = vi.fn();
		const pending = install({ [MARKET_NEXT_PACKAGE]: "^1.0.0" }, callback);
		await disconnect();
		resolve(0);
		await pending;
		expect(callback).not.toHaveBeenCalled();
		expect(message.success).toHaveBeenCalledWith(
			"operations.progress.selfSubmittedSuccess",
		);
		expect(installProgressState.status).toBe("success");
	});

	it("自更新断连 + skipCallbackOnDisconnect=false:仍执行 callback", async () => {
		const { resolve } = pendingTask();
		const callback = vi.fn();
		const pending = install(
			{ [MARKET_NEXT_PACKAGE]: "^1.0.0" },
			callback,
			false,
			{
				skipCallbackOnDisconnect: false,
			},
		);
		await disconnect();
		resolve(0);
		await pending;
		expect(callback).toHaveBeenCalledOnce();
	});

	it("断连后 callback 抛错只告警不升级为失败", async () => {
		const { resolve } = pendingTask();
		const callback = vi.fn().mockRejectedValue(new Error("late refresh"));
		const pending = install({}, callback, false, {
			allowDisconnectSuccess: true,
		});
		await disconnect();
		resolve(0);
		await pending;
		expect(console.warn).toHaveBeenCalled();
		expect(installProgressState.status).toBe("success");
		expect(message.error).not.toHaveBeenCalled();
	});

	it("断连失败不触发 fallback 重试(真实退出码才会)", async () => {
		const { resolve } = pendingTask();
		const pending = install({});
		await disconnect();
		resolve(0);
		expect(await pending).toBeUndefined();
		expect(send).not.toHaveBeenCalledWith(
			"market/install-fallback-candidate",
			undefined,
		);
		expect(installProgressState.retryFallback).toBeUndefined();
	});

	it("未断连时 socket 一直在线:成功走普通 toast", async () => {
		const { resolve } = pendingTask();
		const pending = install({});
		resolve(0);
		await pending;
		expect(message.success).toHaveBeenCalledWith(
			"operations.progress.successToast",
		);
	});
});

describe("install 等待日志", () => {
	it("8 秒未响应追加等待文案,任务随后完成仍算成功", async () => {
		vi.useFakeTimers();
		const { resolve } = pendingTask();
		const pending = install({});
		await vi.advanceTimersByTimeAsync(8000);
		expect(
			installProgressState.logs.some(
				({ line }) => line === "operations.progress.waitingDependencies",
			),
		).toBe(true);
		resolve(0);
		await pending;
		expect(installProgressState.status).toBe("success");
	});

	it("自更新的等待文案使用 waitingSelf", async () => {
		vi.useFakeTimers();
		let resolve!: (code: number) => void;
		const task = new Promise<number>((res) => (resolve = res));
		send.mockImplementation((event: string) =>
			event === "market/install" ? task : undefined,
		);
		const pending = install({ [MARKET_NEXT_PACKAGE]: "" });
		await vi.advanceTimersByTimeAsync(8000);
		expect(
			installProgressState.logs.some(
				({ line }) => line === "operations.progress.waitingSelf",
			),
		).toBe(true);
		resolve(0);
		await pending;
	});

	it("waitingText 覆盖默认等待文案", async () => {
		vi.useFakeTimers();
		let resolve!: (code: number) => void;
		const task = new Promise<number>((res) => (resolve = res));
		send.mockImplementation((event: string) =>
			event === "market/install" ? task : undefined,
		);
		const pending = install({}, undefined, false, { waitingText: "再等等" });
		await vi.advanceTimersByTimeAsync(8000);
		expect(
			installProgressState.logs.some(({ line }) => line === "再等等"),
		).toBe(true);
		resolve(0);
		await pending;
	});

	it("任务 8 秒内完成时不追加等待日志", async () => {
		vi.useFakeTimers();
		const { resolve } = pendingTask();
		const pending = install({});
		resolve(0);
		await pending;
		await vi.advanceTimersByTimeAsync(9000);
		expect(
			installProgressState.logs.some(({ line }) => line.includes("waiting")),
		).toBe(false);
	});
});
