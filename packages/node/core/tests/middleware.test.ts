// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 中间件运行时测试。
 *
 * 通过 trace 包装器记录中间件的实际调用顺序，配合 mock 客户端
 * 验证洋葱模型的调度语义：next 透传 / 提前终止 / prepend 插队、
 * next 传参（字符串、回调）与 compose、异常处理（普通错误记日志、
 * SessionError 转用户文案），以及孤立 next、调用栈超限等边界。
 */
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	jest,
} from "bun:test";
import {
	App,
	Logger,
	type Middleware,
	type Next,
	noop,
	SessionError,
	sleep,
} from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";

type NextCallback = Extract<Next.Callback, (...args: never[]) => unknown>;

const app = new App();
app.plugin(mock);

const print = jest.fn();
const client = app.mock.client("123");

beforeAll(() => app.start());

// 挂一个自定义日志 target：捕获 session 通道的 warn 输出用于断言
beforeAll(() => {
	Logger.levels.base = 1;
	Logger.targets.push({
		levels: { base: 0, session: 2 },
		print,
	});
});

afterAll(() => {
	Logger.levels.base = 2;
	Logger.targets.pop();
});

describe("Middleware Runtime", () => {
	let callSequence: unknown[];

	beforeEach(() => {
		print.mockClear();
		// 清空中间件队列，避免用例间互相干扰（内置 attach 中间件一并清除）
		app.$processor._hooks = [];
		callSequence = [];
	});

	/** 包装中间件：调用时把自身记入 callSequence，用于断言执行顺序。 */
	function trace<T extends (...args: never[]) => unknown>(callback: T) {
		const wrapper = jest.fn((...args: Parameters<T>) => {
			callSequence.push(wrapper);
			return callback.apply(null, args) as ReturnType<T>;
		});
		return wrapper;
	}

	it("basic 1 (next callback)", async () => {
		// mid1 异步放行后 mid2 返回 "bar" 作为回复
		const mid1 = trace<Middleware>((_, next) => sleep(0).then(() => next()));
		const mid2 = trace<Middleware>((_, _next) => "bar");
		app.middleware(mid1);
		app.middleware(mid2);
		await client.shouldReply("foo", "bar");
		expect(callSequence).toEqual([mid1, mid2]);
	});

	it("basic 2 (return empty string)", async () => {
		// 空字符串与 undefined 同义：不产生回复，但链继续传递
		const mid1 = trace<Middleware>((_, next) => next());
		const mid2 = trace<Middleware>((_, _next) => "");
		app.middleware(mid1);
		app.middleware(mid2);
		await client.shouldNotReply("foo");
		expect(callSequence).toEqual([mid1, mid2]);
	});

	it("basic 3 (early termination)", async () => {
		// mid1 不调 next：链终止，mid2 不执行且无回复
		const mid1 = trace<Middleware>(noop);
		const mid2 = trace<Middleware>((_, _next) => "bar");
		app.middleware(mid1);
		app.middleware(mid2);
		await client.shouldNotReply("foo");
		expect(callSequence).toEqual([mid1]);
	});

	it("basic 4 (prepend middleware)", async () => {
		// prepend=true 的中间件插到队列头部，后插的更靠前
		const mid1 = trace<Middleware>((_, next) => next());
		const mid2 = trace<Middleware>((_, next) => next());
		const mid3 = trace<Middleware>((_, next) => next());
		app.middleware(mid1);
		app.middleware(mid2, true);
		app.middleware(mid3, true);
		await client.shouldNotReply("foo");
		expect(callSequence).toEqual([mid3, mid2, mid1]);
	});

	it("next 1 (parameter)", async () => {
		// next(字符串)：作为本层返回值直接透传，最外层的生效（"bar"）
		const mid1 = trace<Middleware>((_, next) => next("bar"));
		const mid2 = trace<Middleware>((_, next) => next("baz"));
		app.middleware(mid1);
		app.middleware(mid2);
		await client.shouldReply("foo", "bar");
		expect(callSequence).toEqual([mid1, mid2]);
	});

	it("next 2 (callback)", async () => {
		// next(函数)：函数追加到队列尾部，返回值同样取最外层（"bar"）
		const mid1 = trace<Middleware>((_, next) => next(() => "bar"));
		const mid2 = trace<Middleware>((_, next) => next(() => "baz"));
		app.middleware(mid1);
		app.middleware(mid2);
		await client.shouldReply("foo", "bar");
		expect(callSequence).toEqual([mid1, mid2]);
	});

	it("next 3 (compose)", async () => {
		// next(中间件) 动态追加多层：原有队列执行完后依次执行追加层
		// （按依赖顺序先声明内层，避免闭包内前向引用）
		const mid5 = trace<NextCallback>((next) => next?.());
		const mid4 = trace<NextCallback>((next) => next?.());
		const mid3 = trace<NextCallback>((next) => next?.(mid5));
		const mid1 = trace<Middleware>((_, next) => next(mid3));
		const mid2 = trace<Middleware>((_, next) => next(mid4));
		app.middleware(mid1);
		app.middleware(mid2);
		await client.shouldNotReply("foo");
		expect(callSequence).toEqual([mid1, mid2, mid3, mid4, mid5]);
	});

	const path = "internal.low-authority";

	it("error 1 (middleware error)", async () => {
		// 中间件抛普通错误：不回复，只记一条 session warn 日志
		app.middleware(() => {
			throw new Error(path);
		});
		await client.shouldNotReply("foo");
		expect(print.mock.calls).toHaveLength(1);
	});

	it("error 2 (next error)", async () => {
		// next 追加的回调抛错同样被捕获记录
		app.middleware((_, next) =>
			next(() => {
				throw new Error(path);
			}),
		);
		await client.shouldNotReply("foo");
		expect(print.mock.calls).toHaveLength(1);
	});

	it("error 3 (error message)", async () => {
		// SessionError：按 i18n 路径渲染成用户文案回复，不产生日志
		app.middleware(() => {
			throw new SessionError(path);
		});
		await client.shouldReply("foo", "权限不足。");
		expect(print.mock.calls).toHaveLength(0);
	});

	it("edge case 1 (isolated next)", async () => {
		// 会话结束后才调用 next（孤立 next）：记一条错误日志
		app.middleware((_, next) => {
			next();
			return undefined;
		});
		app.middleware((_, next) => sleep(0).then(() => next()));
		await client.shouldNotReply("foo");
		await sleep(0);
		expect(print.mock.calls).toHaveLength(1);
	});

	it("edge case 2 (stack exceeded)", async () => {
		// 无限 next 自递归：超过 MAX_DEPTH 后报错并记日志
		const compose: Next.Callback = (next) => next?.(compose);
		app.middleware((_, next) => next(compose));
		await client.shouldNotReply("foo");
		await sleep(0);
		expect(print.mock.calls).toHaveLength(1);
	});
});
