/**
 * idle-probe.ts 单测:setupIdleProbe 的三重门控调度(boot 延迟/失败重试窗口/
 * 成功间隔)、连接数切换(有人用取消/没人用恢复)、安装中让路、探测任务
 * 成败三分支与 running 互斥、停用与析构清理。
 *
 * 策略:fake timers(含 Date)+ trigger 驱动 ready/console/connection 事件;
 * 全程无真实 I/O,advanceTimersByTimeAsync 同时推进时钟与微任务队列。
 */

import { Time } from "@koishi-ce/koishi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
import { setupIdleProbe } from "../idle-probe.js";
import { createMockContext, type MockContext } from "./helpers.js";

// vitest 的 ESM 链直连 koishi 会触发互操作崩溃,mock 成 CJS 产物(Time 为真实符号)。
const MIN = Time.minute;
const HOUR = Time.hour;

let ctx: MockContext;

function setup(config: Partial<Config> = {}) {
	setupIdleProbe(ctx.asContext(), config as Config);
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(0);
	ctx = createMockContext();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("setupIdleProbe", () => {
	it("idleProbe=false 直接返回:不注册事件也不注册析构", () => {
		setup({ idleProbe: false });

		expect(ctx.on).not.toHaveBeenCalled();
		expect(ctx.effect).not.toHaveBeenCalled();
	});

	it("ready 后按 max(空闲延迟, boot 延迟) 调度首轮,到点执行探测", async () => {
		setup();
		ctx.trigger("ready");

		// 默认:空闲延迟 5 分钟 > boot 延迟 1 分钟
		await vi.advanceTimersByTimeAsync(5 * MIN - 1);
		expect(ctx.installer.probeDependenciesInBackground).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(ctx.installer.probeDependenciesInBackground).toHaveBeenCalledWith(
			"idle",
		);
		// deps 探测成功(无 market 服务也算成功)→ info 日志
		expect(ctx.log.info).toHaveBeenCalledWith(
			expect.stringContaining("idle background probe completed"),
		);
	});

	it("boot 延迟未到时重排:按剩余 boot 等待时间再调度", async () => {
		setup({ idleProbeDelay: 1000, idleProbeBootDelay: 60000 });
		ctx.trigger("ready");
		// schedule 排 60s;5s 后连接事件触发重排为短空闲延迟 1s
		await vi.advanceTimersByTimeAsync(5000);
		ctx.trigger("console/connection");
		await vi.advanceTimersByTimeAsync(1000);

		// boot 门控未过:重排 54s,不跑探测
		expect(ctx.installer.probeDependenciesInBackground).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(54000);
		expect(ctx.installer.probeDependenciesInBackground).toHaveBeenCalledTimes(
			1,
		);
	});

	it("ready 时已有客户端连接则不进入调度", async () => {
		setup();
		ctx.console.clients = { alice: 1 };
		ctx.trigger("ready");
		await vi.advanceTimersByTimeAsync(10 * MIN);

		expect(ctx.installer.probeDependenciesInBackground).not.toHaveBeenCalled();
	});

	it("到点时有人连接则本轮直接放弃", async () => {
		setup();
		ctx.trigger("ready");
		await vi.advanceTimersByTimeAsync(4 * MIN);
		ctx.console.clients = { alice: 1 };
		await vi.advanceTimersByTimeAsync(MIN);

		expect(ctx.installer.probeDependenciesInBackground).not.toHaveBeenCalled();
	});

	it("安装进行中让路并按空闲延迟重排", async () => {
		setup();
		ctx.trigger("ready");
		ctx.installer.isInstalling = true;
		await vi.advanceTimersByTimeAsync(5 * MIN);

		expect(ctx.installer.probeDependenciesInBackground).not.toHaveBeenCalled();
		expect(ctx.log.debug).toHaveBeenCalledWith(
			"skip idle background probe because dependency install is active",
		);

		ctx.installer.isInstalling = false;
		await vi.advanceTimersByTimeAsync(5 * MIN);
		expect(ctx.installer.probeDependenciesInBackground).toHaveBeenCalledTimes(
			1,
		);
	});

	it("失败后进入 5 分钟重试窗口:窗口内重排,窗口过后再跑", async () => {
		setup();
		ctx.installer.probeDependenciesInBackground.mockRejectedValue(
			new Error("dep down"),
		);
		ctx.trigger("ready");

		await vi.advanceTimersByTimeAsync(5 * MIN);
		expect(ctx.installer.probeDependenciesInBackground).toHaveBeenCalledTimes(
			1,
		);
		expect(ctx.log.warn).toHaveBeenCalledWith(
			expect.stringContaining("idle background probe failed: dep down"),
		);

		// 4 分钟后重试窗口未过:只重排不跑
		await vi.advanceTimersByTimeAsync(4 * MIN);
		expect(ctx.installer.probeDependenciesInBackground).toHaveBeenCalledTimes(
			1,
		);

		// 窗口结束:真正重试
		await vi.advanceTimersByTimeAsync(MIN);
		expect(ctx.installer.probeDependenciesInBackground).toHaveBeenCalledTimes(
			2,
		);
	});

	it("重试窗口与配置间隔取小", async () => {
		setup({ idleProbeInterval: MIN });
		ctx.installer.probeDependenciesInBackground.mockRejectedValue(
			new Error("x"),
		);
		ctx.trigger("ready");

		await vi.advanceTimersByTimeAsync(5 * MIN);
		// 失败后排 min(5min, 1min) = 1min
		await vi.advanceTimersByTimeAsync(MIN - 1);
		expect(ctx.installer.probeDependenciesInBackground).toHaveBeenCalledTimes(
			1,
		);
		await vi.advanceTimersByTimeAsync(1);
		expect(ctx.installer.probeDependenciesInBackground).toHaveBeenCalledTimes(
			2,
		);
	});

	it("成功后按完整间隔调度,间隔未到只重排", async () => {
		setup();
		ctx.trigger("ready");
		await vi.advanceTimersByTimeAsync(5 * MIN);
		expect(ctx.installer.probeDependenciesInBackground).toHaveBeenCalledTimes(
			1,
		);

		// 成功后排 6 小时间隔
		await vi.advanceTimersByTimeAsync(6 * HOUR - MIN);
		expect(ctx.installer.probeDependenciesInBackground).toHaveBeenCalledTimes(
			1,
		);

		await vi.advanceTimersByTimeAsync(MIN);
		expect(ctx.installer.probeDependenciesInBackground).toHaveBeenCalledTimes(
			2,
		);
	});

	it("console.clients 为 undefined 时视作 0 连接,照常调度", async () => {
		setup();
		ctx.console.clients = undefined as never;
		ctx.trigger("ready");
		await vi.advanceTimersByTimeAsync(5 * MIN);

		expect(ctx.installer.probeDependenciesInBackground).toHaveBeenCalledTimes(
			1,
		);
	});

	it("失败重试窗口内被连接事件重排:按剩余窗口延后,窗口过后才重试", async () => {
		// 空闲延迟(1min)小于重试窗口(5min),让 connection 重排能打破窗口
		setup({ idleProbeDelay: MIN, idleProbeBootDelay: 0 });
		ctx.installer.probeDependenciesInBackground.mockRejectedValue(
			new Error("dep down"),
		);
		ctx.trigger("ready");

		// 首轮失败(t=1min),失败后排 5min 重试窗口
		await vi.advanceTimersByTimeAsync(MIN);
		expect(ctx.installer.probeDependenciesInBackground).toHaveBeenCalledTimes(
			1,
		);

		// 30s 后连接归零触发短空闲延迟重排(t=1.5min 起 1min)
		await vi.advanceTimersByTimeAsync(30 * 1000);
		ctx.trigger("console/connection");
		await vi.advanceTimersByTimeAsync(MIN);

		// 到点时距上次失败仅 1.5min,窗口未过:只重排不重试
		expect(ctx.installer.probeDependenciesInBackground).toHaveBeenCalledTimes(
			1,
		);

		// 剩余 3.5min 窗口过后真正重试
		await vi.advanceTimersByTimeAsync(3.5 * MIN);
		expect(ctx.installer.probeDependenciesInBackground).toHaveBeenCalledTimes(
			2,
		);
	});

	it("成功间隔内被连接事件重排:按剩余间隔延后", async () => {
		setup();
		ctx.trigger("ready");
		await vi.advanceTimersByTimeAsync(5 * MIN);
		expect(ctx.installer.probeDependenciesInBackground).toHaveBeenCalledTimes(
			1,
		);

		// 成功后排 6h 间隔;1h 后连接归零按 5min 空闲延迟重排
		await vi.advanceTimersByTimeAsync(HOUR);
		ctx.trigger("console/connection");
		await vi.advanceTimersByTimeAsync(5 * MIN);

		// 到点时距上次成功仅 1h5min,间隔未到:只重排不跑
		expect(ctx.installer.probeDependenciesInBackground).toHaveBeenCalledTimes(
			1,
		);

		// 剩余间隔走完后跑第二轮
		await vi.advanceTimersByTimeAsync(6 * HOUR - HOUR - 5 * MIN);
		expect(ctx.installer.probeDependenciesInBackground).toHaveBeenCalledTimes(
			2,
		);
	});

	it("连接数从有变无恢复调度,从无变有取消调度", async () => {
		setup();
		ctx.trigger("ready");

		ctx.console.clients = { alice: 1 };
		ctx.trigger("console/connection");
		expect(ctx.log.debug).toHaveBeenCalledWith(
			expect.stringContaining("idle background probe cancelled: clients=1"),
		);
		await vi.advanceTimersByTimeAsync(10 * MIN);
		expect(ctx.installer.probeDependenciesInBackground).not.toHaveBeenCalled();

		ctx.console.clients = {};
		ctx.trigger("console/connection");
		await vi.advanceTimersByTimeAsync(5 * MIN);
		expect(ctx.installer.probeDependenciesInBackground).toHaveBeenCalledTimes(
			1,
		);
	});

	it("market 服务探测成功也算整体成功", async () => {
		setup();
		ctx.installer.probeDependenciesInBackground.mockRejectedValue(
			new Error("dep down"),
		);
		const marketProbe = vi.fn(async () => true);
		ctx.console.services["market"] = { probeInBackground: marketProbe };
		ctx.trigger("ready");

		await vi.advanceTimersByTimeAsync(5 * MIN);

		expect(marketProbe).toHaveBeenCalledWith("idle probe");
		expect(ctx.log.info).toHaveBeenCalledWith(
			expect.stringContaining("probe completed"),
		);
		expect(ctx.log.warn).not.toHaveBeenCalled();
	});

	it("deps 与 market 全失败时 warn 原因为 deps 的错误", async () => {
		setup();
		ctx.installer.probeDependenciesInBackground.mockRejectedValue(
			new Error("dep down"),
		);
		const marketProbe = vi.fn(async () => false);
		ctx.console.services["market"] = { probeInBackground: marketProbe };
		ctx.trigger("ready");

		await vi.advanceTimersByTimeAsync(5 * MIN);

		expect(ctx.log.warn).toHaveBeenCalledWith(
			expect.stringContaining("idle background probe failed: dep down"),
		);
		expect(ctx.log.info).not.toHaveBeenCalled();
	});

	it("running 互斥:上一轮未结束时新到点直接返回", async () => {
		let releaseDeps: (() => void) | undefined;
		ctx.installer.probeDependenciesInBackground.mockImplementationOnce(
			() =>
				new Promise<void>((resolveDeps) => {
					releaseDeps = resolveDeps;
				}),
		);
		setup();
		ctx.trigger("ready");

		// 第一轮探测挂起
		await vi.advanceTimersByTimeAsync(5 * MIN);
		expect(ctx.installer.probeDependenciesInBackground).toHaveBeenCalledTimes(
			1,
		);

		// 挂起期间连接归零事件重排;第二次到点因 running 直接返回
		ctx.trigger("console/connection");
		await vi.advanceTimersByTimeAsync(5 * MIN);
		expect(ctx.installer.probeDependenciesInBackground).toHaveBeenCalledTimes(
			1,
		);

		// 释放第一轮,收尾按结果续排
		releaseDeps?.();
		await vi.advanceTimersByTimeAsync(0);
		expect(ctx.log.info).toHaveBeenCalledWith(
			expect.stringContaining("probe completed"),
		);
	});

	it("插件停用(scope.isActive=false)后定时器到点不执行探测", async () => {
		setup();
		ctx.trigger("ready");
		ctx.scope.isActive = false;
		await vi.advanceTimersByTimeAsync(10 * MIN);

		expect(ctx.installer.probeDependenciesInBackground).not.toHaveBeenCalled();
	});

	it("插件停用后连接归零事件不再排新定时器", async () => {
		setup();
		ctx.scope.isActive = false;
		ctx.trigger("console/connection");
		await vi.advanceTimersByTimeAsync(10 * MIN);

		expect(ctx.installer.probeDependenciesInBackground).not.toHaveBeenCalled();
	});

	it("析构(effect dispose)清掉未触发的定时器", async () => {
		setup();
		ctx.trigger("ready");
		ctx.close();
		await vi.advanceTimersByTimeAsync(10 * MIN);

		expect(ctx.installer.probeDependenciesInBackground).not.toHaveBeenCalled();
	});
});
