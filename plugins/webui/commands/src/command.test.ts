import { describe, expect, it } from "bun:test";
import { remove } from "./command.ts";

/** command.ts 内部工具 remove 的直测（从对象摘除键并返回被摘除的值） */
describe("remove 工具函数", () => {
	it("摘除已有键并返回其值", () => {
		const object = { foo: 1, bar: 2 };
		expect(remove(object, "foo")).toBe(1);
		// toEqual 按实际值类型推断期望值，键被摘除后需放宽到字典形态比对
		expect(object as Record<string, number>).toEqual({ bar: 2 });
	});

	it("键不存在时返回 undefined 且不改动对象", () => {
		const object = { bar: 2 };
		expect(remove(object, "baz" as keyof typeof object)).toBeUndefined();
		expect(object).toEqual({ bar: 2 });
	});
});
