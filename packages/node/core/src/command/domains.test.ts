// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 内置参数类型（domain）补充测试。
 *
 * parser.test.ts 已覆盖 number / posint / string / text / boolean / img，
 * 这里补齐其余内置 domain 的转换与校验行为：
 * integer / natural / bigint / date 数值类，user / channel 标识类。
 */
import { describe, expect, it } from "bun:test";
import {
	Context as App,
	type Argv,
	type Session,
} from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";

const app = new App();
app.plugin(mock);
const bot = app.bots[0]!;

/** 构造带会话的 argv（user / channel domain 需要 platform 上下文） */
function createArgv(): Argv {
	const session = bot.session({}) as Session;
	session.platform = "mock";
	return { session };
}

/** 直接调用值转换，返回 [取值, 错误] */
function parse(type: string, source: string) {
	const argv = createArgv();
	const value = app.$commander.parseValue(
		source,
		"argument",
		argv,
		{
			type: type as Argv.DomainType,
			name: "test",
		},
	);
	return [value, argv.error] as const;
}

describe("Builtin Domains", () => {
	it("integer 接受整数与千位分隔", () => {
		expect(parse("integer", "42")).toEqual([42, undefined]);
		expect(parse("integer", "1_000")).toEqual([
			1000,
			undefined,
		]);
		expect(parse("integer", "1,000")).toEqual([
			1000,
			undefined,
		]);
	});

	it("integer 拒绝非整数", () => {
		const [value, error] = parse("integer", "1.5");
		expect(value).toBeUndefined();
		expect(error).toBeTruthy();
		const [value2, error2] = parse("integer", "abc");
		expect(value2).toBeUndefined();
		expect(error2).toBeTruthy();
	});

	it("natural 接受非负整数", () => {
		expect(parse("natural", "0")).toEqual([0, undefined]);
		expect(parse("natural", "7")).toEqual([7, undefined]);
		const [, error] = parse("natural", "-1");
		expect(error).toBeTruthy();
	});

	it("bigint 大整数", () => {
		expect(parse("bigint", "9007199254740993")).toEqual([
			9007199254740993n,
			undefined,
		]);
		const [, error] = parse("bigint", "not-a-number");
		expect(error).toBeTruthy();
	});

	it("date 日期", () => {
		const [value, error] = parse("date", "2024-01-01");
		expect(error).toBeFalsy();
		expect(Number(value)).toBe(
			new Date("2024-01-01").getTime(),
		);
		const [, error2] = parse("date", "not-a-date");
		expect(error2).toBeTruthy();
	});

	it("user 标识的三种写法", () => {
		// @id 简写：补全会话平台前缀
		expect(parse("user", "@123")).toEqual([
			"mock:123",
			undefined,
		]);
		// 已含平台前缀的完整标识原样通过
		expect(parse("user", "@discord:123")).toEqual([
			"discord:123",
			undefined,
		]);
		// at 元素：取其 id 属性
		expect(parse("user", '<at id="456"/>')).toEqual([
			"mock:456",
			undefined,
		]);
		// 非法输入
		const [, error] = parse("user", "nonsense");
		expect(error).toBeTruthy();
	});

	it("channel 标识的三种写法", () => {
		expect(parse("channel", "#123")).toEqual([
			"mock:123",
			undefined,
		]);
		expect(parse("channel", "#discord:123")).toEqual([
			"discord:123",
			undefined,
		]);
		expect(parse("channel", '<sharp id="789"/>')).toEqual([
			"mock:789",
			undefined,
		]);
		const [, error] = parse("channel", "nonsense");
		expect(error).toBeTruthy();
	});

	it("el / elements / rawtext 贪婪类型", () => {
		// el / elements 解析为元素序列
		const [el] = parse("el", '<at id="1"/> text');
		expect(Array.isArray(el)).toBe(true);
		const [elements] = parse("elements", '<at id="1"/>');
		expect(Array.isArray(elements)).toBe(true);
		// rawtext 保留文本的原始形式（不做反转义）
		const [raw] = parse("rawtext", "a b");
		expect(raw).toBe("a b");
	});
});
