import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import type { KoishiClientStub } from "../../__tests__/helpers";

/**
 * @file applyEnvironmentSnapshot() 的单元测试:环境回滚面板状态、
 * 成功/失败/断连分支、请求失败的超时专属文案与 8 秒等待日志。
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
const { showEnvironmentVersions } = await import("../state");
const { applyEnvironmentSnapshot } = await import("../install");

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
	showEnvironmentVersions.value = true;
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

/** 让 send 只响应快照应用通道。 */
function stubApplyTask(task: Promise<any>) {
	send.mockImplementation((event: string) =>
		event === "market/environment-snapshot-apply"
			? task
			: Promise.resolve(undefined),
	);
}

describe("applyEnvironmentSnapshot 基础流程", () => {
	it("成功:展示回滚面板、收起快照对话框、弹成功 toast", async () => {
		stubApplyTask(Promise.resolve(0));
		await applyEnvironmentSnapshot("snap-1");
		expect(showEnvironmentVersions.value).toBe(false);
		expect(installProgressState).toMatchObject({
			visible: true,
			status: "success",
			title: "operations.progress.environmentTitle",
			selfUpdate: false,
			environmentRestore: true,
		});
		expect(installProgressState.logs).toEqual([
			{ type: "stdout", line: "operations.progress.environmentPreparing" },
		]);
		expect(message.success).toHaveBeenCalledWith(
			"operations.progress.environmentSuccess",
		);
	});

	it("id 与选项原样透传给 RPC", async () => {
		stubApplyTask(Promise.resolve(0));
		await applyEnvironmentSnapshot("snap-2");
		expect(send).toHaveBeenCalledWith(
			"market/environment-snapshot-apply",
			"snap-2",
			{},
		);
	});

	it("失败退出码:标 error 并查询 fallback 候选", async () => {
		send.mockImplementation((event: string) =>
			event === "market/environment-snapshot-apply"
				? Promise.resolve(1)
				: Promise.resolve({
						endpoint: "https://m.example.com",
						label: "镜像",
						reason: "timeout",
					}),
		);
		expect(await applyEnvironmentSnapshot("snap-1")).toBe(1);
		expect(installProgressState.status).toBe("error");
		expect(message.error).toHaveBeenCalledWith(
			"operations.progress.environmentError",
		);
		expect(installProgressState.retryFallback).toBeTypeOf("function");
	});
});

describe("applyEnvironmentSnapshot 断连", () => {
	/** 挂起的快照任务与断连触发。 */
	function pendingApply() {
		let resolve!: (code: number) => void;
		const task = new Promise<number>((res) => (resolve = res));
		stubApplyTask(task);
		return { resolve };
	}

	it("非自更新断连按失败:warning + stderr 日志,返回 undefined", async () => {
		const { resolve } = pendingApply();
		const pending = applyEnvironmentSnapshot("snap-1");
		socket.value = null;
		await nextTick();
		await nextTick();
		resolve(0);
		expect(await pending).toBeUndefined();
		expect(installProgressState.status).toBe("error");
		expect(message.warning).toHaveBeenCalledWith(
			"operations.progress.environmentDisconnectedShort",
		);
		expect(
			installProgressState.logs.some(
				({ line }) => line === "operations.progress.environmentDisconnected",
			),
		).toBe(true);
	});

	it("自更新断连按已提交处理,成功 toast 用 submitted 文案", async () => {
		const { resolve } = pendingApply();
		const pending = applyEnvironmentSnapshot("snap-1", true);
		socket.value = null;
		await nextTick();
		await nextTick();
		resolve(0);
		await pending;
		expect(installProgressState.status).toBe("success");
		expect(message.success).toHaveBeenCalledWith(
			"operations.progress.environmentSubmitted",
		);
	});
});

describe("applyEnvironmentSnapshot 请求失败", () => {
	it("RPC 抛错:environmentErrorTitle 拼接错误详情", async () => {
		stubApplyTask(Promise.reject(new Error("boom")));
		expect(await applyEnvironmentSnapshot("snap-1")).toBeUndefined();
		expect(installProgressState.status).toBe("error");
		expect(message.error).toHaveBeenCalledWith(
			"operations.progress.environmentErrorTitle boom",
		);
		expect(console.error).toHaveBeenCalled();
	});

	it("detail 为 timeout 时使用 environmentTimeout 文案", async () => {
		stubApplyTask(Promise.reject("timeout"));
		expect(await applyEnvironmentSnapshot("snap-1")).toBeUndefined();
		expect(message.error).toHaveBeenCalledWith(
			"operations.progress.environmentTimeout",
		);
	});

	it("8 秒未响应追加回滚等待日志", async () => {
		vi.useFakeTimers();
		let resolve!: (code: number) => void;
		const task = new Promise<number>((res) => (resolve = res));
		stubApplyTask(task);
		const pending = applyEnvironmentSnapshot("snap-1");
		await vi.advanceTimersByTimeAsync(8000);
		expect(
			installProgressState.logs.some(
				({ line }) => line === "operations.progress.environmentWaiting",
			),
		).toBe(true);
		resolve(0);
		await pending;
		expect(installProgressState.status).toBe("success");
	});
});
