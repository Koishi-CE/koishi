import { describe, it } from "bun:test";
import { mock as jest } from "node:test";
import { type Dict, noop, observe } from "@koishi-ce/koishi";
import { expect } from "chai";

/** 观察器 API（observe.ts）的单元测试 */
describe("Observer API", () => {
	// 验证对原语、null、内建类型实例等非法目标调用 observe 均抛错
	it("type checks", () => {
		expect(() => observe(1 as never)).to.throw();
		expect(() => observe("2" as never)).to.throw();
		expect(() => observe(/./ as never)).to.throw();
		expect(() => observe(BigInt(3) as never)).to.throw();
		expect(() => observe(true as never)).to.throw();
		expect(() => observe(noop as never)).to.throw();
		expect(() => observe(Symbol("foo") as never)).to.throw();
		expect(() => observe(Symbol.for("foo") as never)).to.throw();
		expect(() => observe(null as never)).to.throw();
		expect(() => observe(undefined as never)).to.throw();
		expect(() => observe([])).to.throw();
		expect(() => observe(new Date())).to.throw();
		expect(() => observe(new Set())).to.throw();
		expect(() => observe(new Map())).to.throw();
		expect(() => observe(new WeakSet())).to.throw();
		expect(() => observe(new WeakMap())).to.throw();
	});

	// 验证顶层属性的赋值与删除均被记录进 $diff，且重复赋同值不产生 diff
	it("observe property", () => {
		const target: Dict<number> = { a: 1, b: 2 };
		const object = observe(target, "foo");
		expect(object.$diff).to.deep.equal({});

		object.a = 1;
		expect(object).to.deep.equal({ a: 1, b: 2 });
		expect(object.$diff).to.deep.equal({});

		object.a = 2;
		expect(object).to.deep.equal({ a: 2, b: 2 });
		expect(object.$diff).to.deep.equal({ a: 2 });

		object.c = 3;
		expect(object).to.deep.equal({ a: 2, b: 2, c: 3 });
		expect(object.$diff).to.deep.equal({ a: 2, c: 3 });

		delete object.b;
		expect(object).to.deep.equal({ a: 2, c: 3 });
		expect(object.$diff).to.deep.equal({ a: 2, b: undefined, c: 3 });

		delete object.c;
		expect(object).to.deep.equal({ a: 2 });
		expect(object.$diff).to.deep.equal({ a: 2, b: undefined, c: undefined });
	});

	// 验证嵌套对象/数组的深层变更会以顶层键为单位汇总进 $diff
	it("deep observe", () => {
		const object = observe<any>({
			a: { b: 1 },
			c: [{ d: 2 }],
			x: [{ y: 3 }],
		});
		expect(object.$diff).to.deep.equal({});

		object.a.e = 3;
		expect(object).to.deep.equal({
			a: { b: 1, e: 3 },
			c: [{ d: 2 }],
			x: [{ y: 3 }],
		});
		expect(object.$diff).to.deep.equal({
			a: { b: 1, e: 3 },
		});

		object.c.push({ f: 4 });
		expect(object).to.deep.equal({
			a: { b: 1, e: 3 },
			c: [{ d: 2 }, { f: 4 }],
			x: [{ y: 3 }],
		});
		expect(object.$diff).to.deep.equal({
			a: { b: 1, e: 3 },
			c: [{ d: 2 }, { f: 4 }],
		});

		object.x[0].y = 4;
		expect(object).to.deep.equal({
			a: { b: 1, e: 3 },
			c: [{ d: 2 }, { f: 4 }],
			x: [{ y: 4 }],
		});
		expect(object.$diff).to.deep.equal({
			a: { b: 1, e: 3 },
			c: [{ d: 2 }, { f: 4 }],
			x: [{ y: 4 }],
		});

		object.x[1] = [5];
		expect(object).to.deep.equal({
			a: { b: 1, e: 3 },
			c: [{ d: 2 }, { f: 4 }],
			x: [{ y: 4 }, [5]],
		});
		expect(object.$diff).to.deep.equal({
			a: { b: 1, e: 3 },
			c: [{ d: 2 }, { f: 4 }],
			x: [{ y: 4 }, [5]],
		});

		delete object.a.b;
		expect(object).to.deep.equal({
			a: { e: 3 },
			c: [{ d: 2 }, { f: 4 }],
			x: [{ y: 4 }, [5]],
		});
		expect(object.$diff).to.deep.equal({
			a: { e: 3 },
			c: [{ d: 2 }, { f: 4 }],
			x: [{ y: 4 }, [5]],
		});
	});

	// 验证 $update 消费 diff 后，新写入的深层属性仍能被继续追踪
	it("deep observe new property", () => {
		const object = observe<any>({
			a: [],
		});
		expect(object.$diff).to.deep.equal({});

		object.a.push({ b: 1 });
		expect(object.$diff).to.deep.equal({
			a: [{ b: 1 }],
		});

		object.$update();
		expect(object.$diff).to.deep.equal({});

		object.a[0].b = 2;
		expect(object.$diff).to.deep.equal({
			a: [{ b: 2 }],
		});
	});

	// 验证 Date 属性的读取不触发 diff、变更方法（setFullYear）才触发
	it("observe date", () => {
		const object = observe({ foo: new Date() });
		object.foo.getFullYear();
		expect(object.$diff).to.not.have.property("foo");
		object.foo.setFullYear(2000);
		expect(object.$diff).to.have.property("foo");
	});

	// 验证 $update 按批消费变更：无 diff 不回调、消费后 diff 清空
	it("flush changes", () => {
		const flush = jest.fn();
		const object = observe({ a: 1, b: [2] }, flush);
		expect(object.$diff).to.deep.equal({});

		object.$update();
		expect(flush.mock.calls).to.have.length(0);

		object.b.shift();
		expect(object).to.deep.equal({ a: 1, b: [] });
		expect(object.$diff).to.deep.equal({ b: [] });

		object.$update();
		expect(flush.mock.calls).to.have.length(1);
		expect(flush.mock.calls[0].arguments).to.deep.equal([{ b: [] }]);
		expect(object).to.deep.equal({ a: 1, b: [] });
		expect(object.$diff).to.deep.equal({});

		object.a = 3;
		expect(object).to.deep.equal({ a: 3, b: [] });
		expect(object.$diff).to.deep.equal({ a: 3 });

		object.$update();
		expect(flush.mock.calls).to.have.length(2);
		expect(flush.mock.calls[1].arguments).to.deep.equal([{ a: 3 }]);
		expect(object).to.deep.equal({ a: 3, b: [] });
		expect(object.$diff).to.deep.equal({});
	});

	// 验证 $merge 合并外部数据不影响既有 diff，且键冲突时抛错拒绝合并
	it("merge properties", () => {
		const object = observe<any>({ a: 1 });
		expect(object.$diff).to.deep.equal({});

		object.a = 2;
		expect(object).to.deep.equal({ a: 2 });
		expect(object.$diff).to.deep.equal({ a: 2 });

		object.$merge({ b: 3 });
		expect(object).to.deep.equal({ a: 2, b: 3 });
		expect(object.$diff).to.deep.equal({ a: 2 });

		expect(() => object.$merge({ a: 3 })).to.throw();
		expect(object).to.deep.equal({ a: 2, b: 3 });
		expect(object.$diff).to.deep.equal({ a: 2 });
	});
});
