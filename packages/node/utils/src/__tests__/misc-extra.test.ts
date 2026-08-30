import { describe, expect, it } from "bun:test";
import {
	defineEnumProperty,
	extend,
	isInteger,
	merge,
	renameProperty,
	sleep,
} from "@koishi-ce/koishi";

/** 杂项工具函数（misc.ts）的补充测试：数值判断、延时、枚举、深合并与键迁移 */

describe("isInteger", () => {
	it("数值类型经 floor 恒等判定（Infinity 亦通过，NaN 不通过）", () => {
		expect(isInteger(0)).toBe(true);
		expect(isInteger(-5)).toBe(true);
		expect(isInteger(1e10)).toBe(true);
		// 实现为 typeof number && Math.floor(x) === x：Infinity 满足恒等
		expect(isInteger(Infinity)).toBe(true);
		expect(isInteger(1.5)).toBe(false);
		expect(isInteger(NaN)).toBe(false);
		expect(isInteger("3")).toBe(false);
		expect(isInteger(null)).toBe(false);
	});
});

describe("sleep", () => {
	it("等待指定毫秒后 resolve", async () => {
		const startedAt = Date.now();
		await sleep(5);
		expect(Date.now() - startedAt).toBeGreaterThanOrEqual(4);
	});
});

describe("defineEnumProperty", () => {
	it("同时建立键到值与值到键的双向映射", () => {
		const object: Record<string | number, unknown> = {};
		defineEnumProperty(object, "bar", 1);
		expect(object["bar"]).toBe(1);
		expect(object[1]).toBe("bar");
	});
});

describe("merge", () => {
	it("base 独有的键补充进 head，嵌套对象递归合并", () => {
		// merge 会向 head 增补新键，按字典声明避免字面量类型锁死
		const head: Record<string, unknown> = { a: 1, nested: { x: 1, y: 1 } };
		const merged = merge(head, { nested: { y: 2, z: 3 }, extra: "e" });
		// 就地修改并返回 head 本身
		expect(merged).toBe(head);
		expect(head).toEqual({ a: 1, nested: { x: 1, y: 2, z: 3 }, extra: "e" });
	});

	it("head 已有的非对象键被 base 覆盖", () => {
		const head = { a: 1, keep: "h" };
		merge(head, { a: 2, keep: "h" });
		expect(head["a"]).toBe(2);
	});

	it("仅存在于原型链上的键不会被引入（防原型污染）", () => {
		const head: Record<string, unknown> = {};
		merge(head, { toString: "pollute", constructor: "pollute" });
		expect(Object.hasOwn(head, "toString")).toBe(false);
		expect(Object.hasOwn(head, "constructor")).toBe(false);
		// 若被污染，模板字符串会输出 "pollute" 而非默认 toString 结果
		expect(`${head}`).toBe("[object Object]");
	});
});

describe("renameProperty", () => {
	it("旧键的值搬到新键，旧键删除", () => {
		const config: Record<string, unknown> = { old: 42, other: 1 };
		renameProperty(config, "fresh", "old");
		expect(config).toEqual({ fresh: 42, other: 1 });
	});
});

describe("extend", () => {
	it("把方法（连同描述符）批量定义到 prototype 上", () => {
		const proto = {} as { hello?(): string };
		extend(proto, { hello: () => "world" });
		expect(proto.hello?.()).toBe("world");
		expect(Object.getOwnPropertyDescriptor(proto, "hello")?.enumerable).toBe(
			true,
		);
	});
});
