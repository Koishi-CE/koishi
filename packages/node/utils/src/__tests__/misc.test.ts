import { describe, it } from "bun:test";
import { assertProperty, coerce, enumKeys } from "@koishi-ce/koishi";
import { expect } from "chai";

/** 杂项工具函数（misc.ts）的单元测试 */
describe("Miscellaneous", () => {
	// 验证 coerce 能把字符串与 Error 统一格式化为以 "Error: 消息" 开头的堆栈文本
	it("coerce", () => {
		expect(coerce("foo")).to.match(/^Error: foo/);
		expect(coerce(new Error("foo"))).to.match(/^Error: foo/);
	});

	// 验证 enumKeys 能过滤掉数字枚举的反向映射，仅保留字符串键
	it("enumKeys", () => {
		enum Foo {
			bar,
			baz,
		}
		expect(enumKeys(Foo)).to.deep.equal(["bar", "baz"]);
	});

	// 验证 assertProperty 正常返回存在的属性、缺失时抛出带键名的错误
	it("assertProperty", () => {
		expect(assertProperty({ foo: "bar" }, "foo")).to.equal("bar");
		expect(() => assertProperty({}, "foo" as never)).to.throw(
			'missing configuration "foo"',
		);
	});
});
