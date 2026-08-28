/**
 * base/utils 纯工具函数测试：导出解包、配置源分离与键改名。
 */
import { describe, expect, it } from "bun:test";
import type { Dict } from "@koishi-ce/core";
import { rename, separate, unwrapExports } from "./utils";

describe("unwrapExports", () => {
	it("优先取 default 导出", () => {
		expect(unwrapExports({ default: 1, extra: 2 })).toBe(1);
	});

	it("无 default 时原样返回模块", () => {
		expect(unwrapExports({ plugin: true })).toEqual({ plugin: true });
	});

	it("default 为假值时回退到模块本身", () => {
		expect(unwrapExports({ default: null, plugin: true })).toEqual({
			default: null,
			plugin: true,
		});
	});

	it("容忍空输入", () => {
		expect(unwrapExports(undefined)).toBeUndefined();
		expect(unwrapExports(null)).toBeNull();
	});
});

describe("separate", () => {
	it("按 $ 前缀分离元属性与配置", () => {
		const [config, meta] = separate({
			a: 1,
			$if: false,
			b: 2,
			$filter: { userId: "123" },
		});
		expect(config).toEqual({ a: 1, b: 2 });
		expect(meta).toEqual({ $if: false, $filter: { userId: "123" } });
	});

	it("组插件保持原对象作为配置体", () => {
		const source = { a: 1, $if: true };
		const [config, meta] = separate(source, true);
		// 配置体即原对象引用（组内 $ 键随配置整体传递）
		expect(config).toBe(source);
		expect(meta).toEqual({ $if: true });
	});

	it("空输入返回空表", () => {
		expect(separate(undefined)).toEqual([{}, {}]);
	});
});

describe("rename", () => {
	it("就地改名并保持键的相对顺序", () => {
		const object: Dict<unknown> = { a: 1, b: 2, c: 3, d: 4 };
		rename(object, "b", "e", 5);
		expect(object).toEqual({ a: 1, e: 5, c: 3, d: 4 });
		expect(Object.keys(object)).toEqual(["a", "e", "c", "d"]);
	});

	it("匹配带 ~ 前缀的形态", () => {
		const object: Dict<unknown> = { a: 1, "~b": 2, c: 3 };
		rename(object, "b", "e", 5);
		expect(object).toEqual({ a: 1, e: 5, c: 3 });
	});

	it("目标键不存在时追加到末尾", () => {
		const object: Dict<unknown> = { a: 1, b: 2 };
		rename(object, "zzz", "e", 5);
		expect(object).toEqual({ a: 1, b: 2, e: 5 });
	});
});
