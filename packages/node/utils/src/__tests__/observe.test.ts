// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { describe, expect, it } from "bun:test";
import { mock as jest } from "node:test";
import { type Dict, noop, observe } from "@koishi-ce/koishi";

/** 深层观察用例的动态键对象：键名运行时才确定，静态类型不约束属性值 */
type Cell = { [key: string]: unknown };

/** 观察器 API（observe.ts）的单元测试 */
describe("Observer API", () => {
	// 验证对原语、null、内建类型实例等非法目标调用 observe 均抛错
	it("type checks", () => {
		expect(() => observe(1 as never)).toThrow();
		expect(() => observe("2" as never)).toThrow();
		expect(() => observe(/./ as never)).toThrow();
		expect(() => observe(BigInt(3) as never)).toThrow();
		expect(() => observe(true as never)).toThrow();
		expect(() => observe(noop as never)).toThrow();
		expect(() => observe(Symbol("foo") as never)).toThrow();
		expect(() => observe(Symbol.for("foo") as never)).toThrow();
		expect(() => observe(null as never)).toThrow();
		expect(() => observe(undefined as never)).toThrow();
		expect(() => observe([])).toThrow();
		expect(() => observe(new Date())).toThrow();
		expect(() => observe(new Set())).toThrow();
		expect(() => observe(new Map())).toThrow();
		expect(() => observe(new WeakSet())).toThrow();
		expect(() => observe(new WeakMap())).toThrow();
	});

	// 验证顶层属性的赋值与删除均被记录进 $diff，且重复赋同值不产生 diff
	it("observe property", () => {
		const target: Dict<number> = { a: 1, b: 2 };
		const object = observe(target, "foo");
		expect(object.$diff).toEqual({});

		object["a"] = 1;
		expect(object).toEqual<Dict<number>>({ a: 1, b: 2 });
		expect(object.$diff).toEqual({});

		object["a"] = 2;
		expect(object).toEqual<Dict<number>>({ a: 2, b: 2 });
		expect(object.$diff).toEqual({ a: 2 });

		object["c"] = 3;
		expect(object).toEqual<Dict<number>>({ a: 2, b: 2, c: 3 });
		expect(object.$diff).toEqual({ a: 2, c: 3 });

		delete object["b"];
		expect(object).toEqual<Dict<number>>({ a: 2, c: 3 });
		expect(object.$diff).toEqual({ a: 2, b: undefined, c: 3 });

		delete object["c"];
		expect(object).toEqual<Dict<number>>({ a: 2 });
		expect(object.$diff).toEqual({ a: 2, b: undefined, c: undefined });
	});

	// 验证嵌套对象/数组的深层变更会以顶层键为单位汇总进 $diff
	it("deep observe", () => {
		const object = observe<{ a: Cell; c: Cell[]; x: unknown[] }>({
			a: { b: 1 },
			c: [{ d: 2 }],
			x: [{ y: 3 }],
		});
		expect(object.$diff).toEqual({});

		object.a["e"] = 3;
		expect(object).toEqual<{ a: Cell; c: Cell[]; x: unknown[] }>({
			a: { b: 1, e: 3 },
			c: [{ d: 2 }],
			x: [{ y: 3 }],
		});
		expect(object.$diff).toEqual({
			a: { b: 1, e: 3 },
		});

		object.c.push({ f: 4 });
		expect(object).toEqual<{ a: Cell; c: Cell[]; x: unknown[] }>({
			a: { b: 1, e: 3 },
			c: [{ d: 2 }, { f: 4 }],
			x: [{ y: 3 }],
		});
		expect(object.$diff).toEqual({
			a: { b: 1, e: 3 },
			c: [{ d: 2 }, { f: 4 }],
		});

		// 元素是动态键对象与数组的混合，静态类型用断言收窄
		(object.x[0] as Cell)["y"] = 4;
		expect(object).toEqual<{ a: Cell; c: Cell[]; x: unknown[] }>({
			a: { b: 1, e: 3 },
			c: [{ d: 2 }, { f: 4 }],
			x: [{ y: 4 }],
		});
		expect(object.$diff).toEqual({
			a: { b: 1, e: 3 },
			c: [{ d: 2 }, { f: 4 }],
			x: [{ y: 4 }],
		});

		object.x[1] = [5];
		expect(object).toEqual<{ a: Cell; c: Cell[]; x: unknown[] }>({
			a: { b: 1, e: 3 },
			c: [{ d: 2 }, { f: 4 }],
			x: [{ y: 4 }, [5]],
		});
		expect(object.$diff).toEqual({
			a: { b: 1, e: 3 },
			c: [{ d: 2 }, { f: 4 }],
			x: [{ y: 4 }, [5]],
		});

		delete object.a["b"];
		expect(object).toEqual<{ a: Cell; c: Cell[]; x: unknown[] }>({
			a: { e: 3 },
			c: [{ d: 2 }, { f: 4 }],
			x: [{ y: 4 }, [5]],
		});
		expect(object.$diff).toEqual({
			a: { e: 3 },
			c: [{ d: 2 }, { f: 4 }],
			x: [{ y: 4 }, [5]],
		});
	});

	// 验证 $update 消费 diff 后，新写入的深层属性仍能被继续追踪
	it("deep observe new property", () => {
		const object = observe<{ a: Cell[] }>({
			a: [],
		});
		expect(object.$diff).toEqual({});

		object.a.push({ b: 1 });
		expect(object.$diff).toEqual({
			a: [{ b: 1 }],
		});

		object.$update();
		expect(object.$diff).toEqual({});

		object.a[0]!["b"] = 2;
		expect(object.$diff).toEqual({
			a: [{ b: 2 }],
		});
	});

	// 验证 Date 属性的读取不触发 diff、变更方法（setFullYear）才触发
	it("observe date", () => {
		const object = observe({ foo: new Date() });
		object.foo.getFullYear();
		expect(object.$diff).not.toHaveProperty("foo");
		object.foo.setFullYear(2000);
		expect(object.$diff).toHaveProperty("foo");
	});

	// 验证 $update 按批消费变更：无 diff 不回调、消费后 diff 清空
	it("flush changes", () => {
		const flush = jest.fn();
		const object = observe({ a: 1, b: [2] }, flush);
		expect(object.$diff).toEqual({});

		object.$update();
		expect(flush.mock.calls).toHaveLength(0);

		object.b.shift();
		expect(object).toEqual<{ a: number; b: number[] }>({ a: 1, b: [] });
		expect(object.$diff).toEqual({ b: [] });

		object.$update();
		expect(flush.mock.calls).toHaveLength(1);
		expect(flush.mock.calls[0]?.arguments).toEqual([{ b: [] }]);
		expect(object).toEqual<{ a: number; b: number[] }>({ a: 1, b: [] });
		expect(object.$diff).toEqual({});

		object.a = 3;
		expect(object).toEqual<{ a: number; b: number[] }>({ a: 3, b: [] });
		expect(object.$diff).toEqual({ a: 3 });

		object.$update();
		expect(flush.mock.calls).toHaveLength(2);
		expect(flush.mock.calls[1]?.arguments).toEqual([{ a: 3 }]);
		expect(object).toEqual<{ a: number; b: number[] }>({ a: 3, b: [] });
		expect(object.$diff).toEqual({});
	});

	// 验证 $merge 合并外部数据不影响既有 diff，且键冲突时抛错拒绝合并
	it("merge properties", () => {
		const object = observe<{ a: number; b?: number }>({ a: 1 });
		expect(object.$diff).toEqual({});

		object.a = 2;
		expect(object).toEqual<{ a: number; b?: number }>({ a: 2 });
		expect(object.$diff).toEqual({ a: 2 });

		object.$merge({ b: 3 });
		expect(object).toEqual<{ a: number; b?: number }>({ a: 2, b: 3 });
		expect(object.$diff).toEqual({ a: 2 });

		expect(() => object.$merge({ a: 3 })).toThrow();
		expect(object).toEqual<{ a: number; b?: number }>({ a: 2, b: 3 });
		expect(object.$diff).toEqual({ a: 2 });
	});
});
