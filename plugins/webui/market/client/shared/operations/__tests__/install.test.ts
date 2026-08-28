import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KoishiClientStub } from "../../__tests__/helpers";

/**
 * @file install() 基础编排的单元测试:面板状态重置、成功/失败退出码、
 * 自更新判定、文案覆盖、请求失败的上报格式化与 fallback 候选准备。
 * 断连竞态与等待日志见 install-disconnect.test.ts。
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
const { active } = await import("../../plugin-config");
const { MARKET_NEXT_PACKAGE } = await import("../state");
const { install } = await import("../install");

beforeEach(() => {
	send.mockReset();
	message.error.mockReset();
	message.warning.mockReset();
	message.success.mockReset();
	i18nMock.translate.mockClear();
	socket.value = "ws://live";
	vi.spyOn(console, "error").mockImplementation(() => {});
	installProgressState.status = "idle";
	installProgressState.logs = [];
	installProgressState.title = "";
	installProgressState.selfUpdate = false;
	installProgressState.environmentRestore = false;
	resetInstallFallbackState();
	active.value = "pkg-open";
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** 让 send 只响应 market/install,其余通道返回 undefined。 */
function stubInstallTask(task: Promise<any>) {
	send.mockImplementation((event: string) =>
		event === "market/install" ? task : undefined,
	);
}

describe("install 基础流程", () => {
	it("成功:重置并展示面板、执行回调、弹成功 toast", async () => {
		stubInstallTask(Promise.resolve(0));
		const callback = vi.fn();
		await install({ "pkg-a": "^1.0.0" }, callback);
		expect(callback).toHaveBeenCalledOnce();
		expect(active.value).toBe("");
		expect(installProgressState).toMatchObject({
			visible: true,
			status: "success",
			title: "operations.progress.dependencyTitle",
			selfUpdate: false,
			environmentRestore: false,
		});
		expect(installProgressState.logs).toEqual([
			{ type: "stdout", line: "operations.progress.submitted" },
		]);
		expect(message.success).toHaveBeenCalledWith(
			"operations.progress.successToast",
		);
		expect(message.error).not.toHaveBeenCalled();
	});

	it("失败退出码:标 error、弹错误 toast", async () => {
		stubInstallTask(Promise.resolve(1));
		const callback = vi.fn();
		await install({ "pkg-a": "^1.0.0" }, callback);
		expect(installProgressState.status).toBe("error");
		expect(callback).not.toHaveBeenCalled();
		expect(message.error).toHaveBeenCalledWith(
			"operations.progress.installError",
		);
		expect(message.success).not.toHaveBeenCalled();
	});

	it("失败且无 fallback 候选时不挂重试", async () => {
		send.mockImplementation((event: string) =>
			event === "market/install"
				? Promise.resolve(1)
				: Promise.resolve(undefined),
		);
		await install({ "pkg-a": "^1.0.0" });
		expect(send).toHaveBeenCalledWith(
			"market/install-fallback-candidate",
			undefined,
		);
		expect(installProgressState.retryFallback).toBeUndefined();
	});

	it("失败且有 fallback 候选时挂上镜像重试", async () => {
		send.mockImplementation((event: string) =>
			event === "market/install"
				? Promise.resolve(1)
				: Promise.resolve({
						endpoint: "https://m.example.com",
						label: "镜像",
						reason: "timeout",
					}),
		);
		expect(await install({ "pkg-a": "^1.0.0" })).toBe(1);
		expect(installProgressState.fallbackCandidate?.endpoint).toBe(
			"https://m.example.com",
		);
		expect(installProgressState.retryFallback).toBeTypeOf("function");
		expect(
			installProgressState.logs.some(({ line }) =>
				line.includes("fallbackLog"),
			),
		).toBe(true);
	});

	it("forced 与 override 原样透传给 RPC", async () => {
		stubInstallTask(Promise.resolve(0));
		const override = { "pkg-a": "" };
		await install(override, undefined, true);
		expect(send).toHaveBeenCalledWith("market/install", override, true, {});
	});
});

describe("install 自更新", () => {
	it("override 含本插件包名即视为自更新:专属标题与日志、成功 toast", async () => {
		stubInstallTask(Promise.resolve(0));
		await install({ [MARKET_NEXT_PACKAGE]: "^1.0.0" });
		expect(installProgressState.title).toBe(
			"operations.progress.selfUpdateTitle",
		);
		expect(installProgressState.selfUpdate).toBe(true);
		expect(installProgressState.logs).toEqual([
			{ type: "stdout", line: "operations.progress.submitted" },
			{ type: "stdout", line: "operations.progress.selfSubmitted" },
		]);
		expect(message.success).toHaveBeenCalledWith(
			"operations.progress.selfSuccessToast",
		);
	});

	it("messages.selfUpdate 显式覆盖推断", async () => {
		stubInstallTask(Promise.resolve(0));
		await install({ "pkg-a": "^1.0.0" }, undefined, false, {
			selfUpdate: true,
		});
		expect(installProgressState.selfUpdate).toBe(true);
		expect(installProgressState.title).toBe(
			"operations.progress.selfUpdateTitle",
		);
	});
});

describe("install 文案覆盖", () => {
	it("loadingText/successText/errorText 优先生效", async () => {
		stubInstallTask(Promise.resolve(0));
		await install({}, undefined, false, {
			loadingText: "装",
			successText: "成",
		});
		expect(installProgressState.title).toBe("装");
		expect(message.success).toHaveBeenCalledWith("成");
		stubInstallTask(Promise.resolve(1));
		await install({}, undefined, false, { errorText: "败" });
		expect(message.error).toHaveBeenCalledWith("败");
	});
});

describe("install 请求失败上报", () => {
	it("Error 对象:归一为 message,拼进错误 toast 与 stderr 日志", async () => {
		stubInstallTask(Promise.reject(new Error("boom")));
		expect(await install({})).toBeUndefined();
		expect(installProgressState.status).toBe("error");
		expect(message.error).toHaveBeenCalledWith(
			"operations.progress.installError boom",
		);
		const last = installProgressState.logs.at(-1)!;
		expect(last.type).toBe("stderr");
		expect(last.line).toContain("operations.progress.requestFailed");
		expect(last.line).toContain("boom");
	});

	it("detail 恰为 timeout 时切换到超时专属文案", async () => {
		stubInstallTask(Promise.reject("timeout"));
		expect(await install({})).toBeUndefined();
		expect(message.error).toHaveBeenCalledWith(
			"operations.progress.installTimeout",
		);
		stubInstallTask(Promise.reject(new Error("timeout")));
		await install({}, undefined, false, { timeoutText: "T/O" });
		expect(message.error).toHaveBeenLastCalledWith("T/O");
	});

	it("错误形态归一:{message}/{error}/空值逐级回退", async () => {
		stubInstallTask(Promise.reject({ message: "obj-msg" }));
		await install({});
		expect(message.error).toHaveBeenLastCalledWith(
			"operations.progress.installError obj-msg",
		);
		stubInstallTask(Promise.reject({ error: "err-msg" }));
		await install({});
		expect(message.error).toHaveBeenLastCalledWith(
			"operations.progress.installError err-msg",
		);
		stubInstallTask(Promise.reject(null));
		await install({});
		expect(message.error).toHaveBeenLastCalledWith(
			"operations.progress.installError unknown error",
		);
	});

	it("成功后回调抛错:面板转 error 并按请求失败上报", async () => {
		stubInstallTask(Promise.resolve(0));
		const callback = vi.fn().mockRejectedValue(new Error("refresh failed"));
		expect(await install({}, callback)).toBeUndefined();
		expect(installProgressState.status).toBe("error");
		expect(message.error).toHaveBeenCalledWith(
			"operations.progress.installError refresh failed",
		);
	});
});
