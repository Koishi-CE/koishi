// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { describe, expect, it } from "bun:test";
import { resolveExit } from "./start.ts";

/**
 * 父进程退出决策的纯函数测试。
 *
 * 这些分支直接决定 `docker stop` 能否干净退出：收到 SIGTERM 后若还按
 * autoRestart 重新拉起 worker，容器会一直重启到 stop_grace_period 超时
 * 才被 SIGKILL。
 */

const restartable = { autoRestart: true };
const noRestart = { autoRestart: false };

describe("resolveExit", () => {
	it("未收到 start 消息即退出：视为启动失败并跟随退出", () => {
		expect(resolveExit(1, null, undefined, false)).toBe(1);
		// 无退出码时按 1 处理，避免父进程以 0 掩盖启动失败
		expect(resolveExit(null, null, undefined, false)).toBe(
			1,
		);
	});

	it("正常退出码 0：跟随退出", () => {
		expect(resolveExit(0, null, restartable, false)).toBe(
			0,
		);
	});

	it("收到信号：跟随退出（信号终止优先于 autoRestart）", () => {
		expect(
			resolveExit(null, "SIGTERM", restartable, false),
		).toBe(1);
		expect(
			resolveExit(143, "SIGTERM", restartable, false),
		).toBe(143);
	});

	it("退出码 51 请求重启：可重启时返回 null", () => {
		expect(
			resolveExit(51, null, restartable, false),
		).toBeNull();
	});

	it("退出码 52 请求退出：透传退出码", () => {
		expect(resolveExit(52, null, restartable, false)).toBe(
			52,
		);
	});

	it("其余退出码：按 autoRestart 决定重启或退出", () => {
		expect(
			resolveExit(1, null, restartable, false),
		).toBeNull();
		expect(resolveExit(1, null, noRestart, false)).toBe(1);
	});

	it("stopping 优先于一切判断：即使退出码为 51 也不再重启", () => {
		expect(resolveExit(51, null, restartable, true)).toBe(
			51,
		);
		expect(resolveExit(1, null, restartable, true)).toBe(1);
		// 停止信号已发出、worker 未给退出码时按 0 处理
		expect(
			resolveExit(null, "SIGTERM", restartable, true),
		).toBe(0);
	});
});
