/**
 * 已废弃事件 API（waterfall / chain）与 Context 旧式访问器的兼容测试。
 *
 * waterfall / chain 是"瀑布式"事件：前一个监听器的返回值作为下一个的
 * 首参，最终返回链末结果。这里验证有无 thisArg 两种调用形态、
 * 无监听事件的原样返回，以及 deprecated 的 ctx.app / ctx.options 访问器。
 */
import { describe, expect, it } from "bun:test";
import { Context as App, type Context } from "@koishi-ce/koishi";

const app = new App();

/** waterfall / chain 的事件名不在类型表内，借运行时签名调用 */
function waterfall(ctx: Context, ...args: unknown[]) {
	return (ctx.waterfall as (...args: unknown[]) => Promise<unknown>)(...args);
}

function chain(ctx: Context, ...args: unknown[]) {
	return (ctx.chain as (...args: unknown[]) => unknown)(...args);
}

describe("Legacy Events", () => {
	it("waterfall 无监听器时原样返回首参", async () => {
		await expect(waterfall(app, "legacy-event-none", 42)).resolves.toBe(42);
	});

	it("waterfall 依次传递上游返回值", async () => {
		app.on(
			"legacy-waterfall" as never,
			((value: number) => value + 1) as never,
		);
		app.on(
			"legacy-waterfall" as never,
			((value: number) => value * 2) as never,
		);
		// 1 -> 2 -> 4
		await expect(waterfall(app, "legacy-waterfall", 1)).resolves.toBe(4);
	});

	it("waterfall 支持以对象作为 thisArg", async () => {
		const thisArg = { base: 10 };
		app.on(
			"legacy-this-arg" as never,
			function (this: { base: number }, value: number) {
				return this.base + value;
			} as never,
		);
		// thisArg 会从参数列表中剥离，不进入监听器实参
		await expect(waterfall(app, thisArg, "legacy-this-arg", 5)).resolves.toBe(
			15,
		);
	});

	it("chain 为同步瀑布调用", () => {
		app.on("legacy-chain" as never, ((value: string) => `${value}a`) as never);
		app.on("legacy-chain" as never, ((value: string) => `${value}b`) as never);
		expect(chain(app, "legacy-chain", "x")).toBe("xab");
		expect(chain(app, "legacy-chain-none", "y")).toBe("y");
	});

	it("ctx.app 与 ctx.options 指向根上下文配置", () => {
		const ctx = app.extend();
		expect(ctx.app).toBe(app.root);
		expect(ctx.options).toBe(app.root.config);
	});
});
