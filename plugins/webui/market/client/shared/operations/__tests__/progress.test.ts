import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KoishiClientStub } from "../../__tests__/helpers";

/**
 * @file progress.ts 的单元测试:进度面板状态源、install-log 广播的
 * running 态过滤、fallback 重试候选的准备与执行(含防重入与失败分支)。
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

const { getReceiveCallback } = await import("../../__tests__/helpers");
// vi.mock 只是运行时替换,tsc 仍按真实模块类型推导;统一断言为桩视图
const { receive, send } = (await import(
	"@koishi-ce/client"
)) as unknown as KoishiClientStub;
const {
	installProgressState,
	prepareInstallFallbackRetry,
	pushInstallLog,
	resetInstallFallbackState,
} = await import("../progress");

/** 模块加载时已注册的 install-log 广播回调。 */
const onInstallLog = getReceiveCallback(receive, "market/install-log");

beforeEach(() => {
	send.mockReset();
	i18nMock.translate.mockClear();
	vi.spyOn(console, "warn").mockImplementation(() => {});
	installProgressState.status = "idle";
	installProgressState.logs = [];
	installProgressState.title = "";
	installProgressState.selfUpdate = false;
	installProgressState.environmentRestore = false;
	installProgressState.visible = false;
	resetInstallFallbackState();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("install-log 广播", () => {
	it("仅 running 状态追加日志,其余状态丢弃", () => {
		installProgressState.status = "running";
		onInstallLog({ type: "stdout", line: "hello" });
		expect(installProgressState.logs).toEqual([
			{ type: "stdout", line: "hello" },
		]);
		installProgressState.status = "success";
		onInstallLog({ type: "stderr", line: "late" });
		expect(installProgressState.logs).toHaveLength(1);
	});

	it("getReceiveCallback 对未注册通道抛出说明性错误", () => {
		expect(() => getReceiveCallback(receive, "market/not-registered")).toThrow(
			"receive 未注册过通道:market/not-registered",
		);
	});
});

describe("pushInstallLog / resetInstallFallbackState", () => {
	it("追加日志默认 stdout,可指定 stderr", () => {
		pushInstallLog("a");
		pushInstallLog("b", "stderr");
		expect(installProgressState.logs).toEqual([
			{ type: "stdout", line: "a" },
			{ type: "stderr", line: "b" },
		]);
	});

	it("重置清空 fallback 全家状态", () => {
		installProgressState.fallbackCandidate = {
			endpoint: "e",
			label: "l",
			reason: "r",
		};
		installProgressState.fallbackRunning = true;
		installProgressState.fallbackUsed = true;
		installProgressState.retryFallback = async () => {};
		resetInstallFallbackState();
		expect(installProgressState.fallbackCandidate).toBeUndefined();
		expect(installProgressState.fallbackRunning).toBe(false);
		expect(installProgressState.fallbackUsed).toBe(false);
		expect(installProgressState.retryFallback).toBeUndefined();
	});
});

describe("prepareInstallFallbackRetry", () => {
	it("fallbackUsed 或 retryFallback 已存在时直接返回,不发 RPC", async () => {
		installProgressState.fallbackUsed = true;
		await prepareInstallFallbackRetry(vi.fn());
		expect(send).not.toHaveBeenCalled();
		installProgressState.fallbackUsed = false;
		installProgressState.retryFallback = async () => {};
		await prepareInstallFallbackRetry(vi.fn());
		expect(send).not.toHaveBeenCalled();
	});

	it("RPC 无返回、拒绝或候选缺 endpoint 时都不挂重试", async () => {
		send.mockResolvedValue(undefined);
		await prepareInstallFallbackRetry(vi.fn());
		send.mockRejectedValue(new Error("rpc down"));
		await prepareInstallFallbackRetry(vi.fn());
		send.mockResolvedValue({ label: "no-endpoint" });
		await prepareInstallFallbackRetry(vi.fn());
		expect(installProgressState.retryFallback).toBeUndefined();
		expect(installProgressState.fallbackCandidate).toBeUndefined();
		expect(installProgressState.logs).toEqual([]);
	});

	it("有候选时记录视图与日志,并挂上 retryFallback;label 缺省用端点 host", async () => {
		send.mockResolvedValue({
			endpoint: "https://mirror.example.com/r",
			label: "",
			reason: "timeout",
		});
		await prepareInstallFallbackRetry(vi.fn(), "https://registry.npmjs.org");
		expect(send).toHaveBeenCalledWith(
			"market/install-fallback-candidate",
			"https://registry.npmjs.org",
		);
		expect(installProgressState.fallbackCandidate?.endpoint).toBe(
			"https://mirror.example.com/r",
		);
		expect(installProgressState.retryFallback).toBeTypeOf("function");
		expect(installProgressState.logs.at(-1)?.line).toContain(
			"mirror.example.com",
		);
		expect(installProgressState.logs.at(-1)?.line).toContain(
			"operations.progress.fallbackLog",
		);
	});

	it("retryFallback 执行成功:置位 used、清候选、调 run 传端点", async () => {
		send.mockResolvedValue({
			endpoint: "https://mirror.example.com/r",
			label: "镜像",
			reason: "timeout",
		});
		const run = vi.fn().mockResolvedValue(0);
		await prepareInstallFallbackRetry(run);
		await installProgressState.retryFallback!();
		expect(run).toHaveBeenCalledWith({
			installEndpoint: "https://mirror.example.com/r",
		});
		expect(installProgressState.fallbackUsed).toBe(true);
		expect(installProgressState.fallbackCandidate).toBeUndefined();
		expect(installProgressState.retryFallback).toBeUndefined();
		expect(installProgressState.fallbackRunning).toBe(false);
		expect(
			installProgressState.logs.some(({ line }) =>
				line.includes("fallbackConfirmed"),
			),
		).toBe(true);
	});

	it("retryFallback 里 run 失败时标 error 并记录 fallbackFailed 日志", async () => {
		send.mockResolvedValue({
			endpoint: "https://mirror.example.com/r",
			label: "镜像",
			reason: "timeout",
		});
		const run = vi.fn().mockResolvedValue(1);
		await prepareInstallFallbackRetry(run);
		await installProgressState.retryFallback!();
		expect(installProgressState.status).toBe("error");
		expect(
			installProgressState.logs.some(({ type }) => type === "stderr"),
		).toBe(true);
		expect(
			installProgressState.logs.some(({ line }) =>
				line.includes("fallbackFailed"),
			),
		).toBe(true);
	});

	it("run 抛异常时异常向上传播但 fallbackRunning/重试回调被清理", async () => {
		send.mockResolvedValue({
			endpoint: "https://mirror.example.com/r",
			label: "镜像",
			reason: "timeout",
		});
		const run = vi.fn().mockRejectedValue(new Error("again"));
		await prepareInstallFallbackRetry(run);
		await expect(installProgressState.retryFallback!()).rejects.toThrow(
			"again",
		);
		expect(installProgressState.fallbackRunning).toBe(false);
		expect(installProgressState.retryFallback).toBeUndefined();
		expect(installProgressState.fallbackUsed).toBe(true);
	});

	it("retryFallback 并发防抖:执行中再次调用直接返回", async () => {
		send.mockResolvedValue({
			endpoint: "https://mirror.example.com/r",
			label: "镜像",
			reason: "timeout",
		});
		let release!: (code: number) => void;
		const run = vi
			.fn()
			.mockImplementation(
				() => new Promise<number>((resolve) => (release = resolve)),
			);
		await prepareInstallFallbackRetry(run);
		const first = installProgressState.retryFallback!();
		await installProgressState.retryFallback!();
		expect(run).toHaveBeenCalledTimes(1);
		release(0);
		await first;
		expect(installProgressState.fallbackRunning).toBe(false);
	});
});
