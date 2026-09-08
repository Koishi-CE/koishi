// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * cron 插件测试：劫持全局 Bun.cron 验证包装层契约——服务注册、表达式与
 * tz 透传、取消函数到 job.stop 的链路、回调错误捕获。原生调度与表达式
 * 解析属 Bun.cron 自身行为（对上游 setTimeout 溢出缺陷的规避即在于此），
 * 不在本仓测试范围内重复验证。
 *
 * 劫持方式为直接赋值替换（Bun.cron 的描述符不可配置但可写）并在
 * finally 中恢复原值。
 */
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
} from "bun:test";
import { App } from "@koishi-ce/koishi";
import * as cron from "@koishi-ce/plugin-cron";

/** Bun.cron 的调用记录（表达式 / 包装回调 / options）与停止记录 */
interface CronHijack {
	calls: [
		string,
		() => Promise<void>,
		{ tz: string } | undefined,
	][];
	stops: string[];
	restore(): void;
}

function hijackCron(): CronHijack {
	const calls: CronHijack["calls"] = [];
	const stops: string[] = [];
	const original = Bun.cron;
	const fake = ((
		input: string,
		callback: () => Promise<void>,
		options?: { tz: string },
	) => {
		calls.push([input, callback, options]);
		const job = {
			cron: input,
			stop() {
				stops.push(input);
				return job;
			},
			ref() {
				return job;
			},
			unref() {
				return job;
			},
		};
		return job as unknown as Bun.CronJob;
	}) as unknown as typeof Bun.cron;
	// Bun.cron 的描述符为 writable / enumerable 但不可配置，直接赋值替换
	// （defineProperty 会被 configurable 检查拒绝）；类型上其为 readonly，
	// 借可写视图赋值
	const writableBun = Bun as { cron: typeof Bun.cron };
	writableBun.cron = fake;
	return {
		calls,
		stops,
		restore() {
			writableBun.cron = original;
		},
	};
}

const app = new App();

app.plugin(cron, { tz: "UTC" });

beforeAll(() => app.start());
afterAll(() => app.stop());

describe("@koishi-ce/plugin-cron", () => {
	it("注册 ctx.cron 服务", () => {
		expect(typeof app.cron).toBe("function");
	});

	it("无效表达式在注册时同步抛错", () => {
		expect(() => app.cron("not a cron", () => {})).toThrow(
			TypeError,
		);
	});

	it("透传表达式与 tz，取消函数停止任务", () => {
		const hijack = hijackCron();
		try {
			const dispose = app.cron("* * * * *", () => {});
			expect(hijack.calls[0]?.[0]).toBe("* * * * *");
			expect(hijack.calls[0]?.[2]).toEqual({ tz: "UTC" });
			expect(hijack.stops).toHaveLength(0);

			dispose();
			expect(hijack.stops).toEqual(["* * * * *"]);
		} finally {
			hijack.restore();
		}
	});

	it("捕获回调抛出的错误且不中断包装回调", async () => {
		const hijack = hijackCron();
		// 该用例会真实触发一次包装层的错误日志，用例内静默 cron 域并恢复
		const logger = app.logger("cron");
		const level = logger.level;
		logger.level = 0;
		try {
			app.cron("*/5 * * * *", () => {
				throw new Error("boom");
			});
			const wrapped = hijack.calls[0]?.[1];
			if (!wrapped) throw new Error("未捕获到包装回调");
			// 回调抛错由包装层捕获：包装回调正常完成而非 reject
			await expect(wrapped()).resolves.toBeUndefined();
			expect(hijack.stops).toHaveLength(0);
		} finally {
			logger.level = level;
			hijack.restore();
		}
	});
});
