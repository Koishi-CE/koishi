// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * tokenizer 补充测试：插值还原与插值语法注册。
 *
 * parser.test.ts 覆盖常规词法行为，这里补：
 * - Argv.revert：单引号 token 内的插值不求值，靠 revert 恢复原文；
 * - 全局 interpolate / 实例级 interpolate 两种插值语法注册方式
 *   （实例注册仅对本实例可见，不影响全局默认 tokenizer）。
 */
import { describe, expect, it } from "bun:test";
import "../../../tests/shape.ts";
import { Argv } from "./argv.ts";
import { bracs, Tokenizer } from "./tokenizer.ts";

describe("Tokenizer Interpolation", () => {
	it("单引号内的插值不求值，revert 恢复原文", () => {
		const argv = Argv.parse("'foo $(bar) baz'");
		// parse 后 tokens 恒存在，收窄为局部变量供逐项断言
		const tokens = argv.tokens!;
		expect(tokens).toHaveLength(1);
		// 单引号 token 内容保持原文（含插值语法的字面形式），且已闭合
		expect(tokens[0]).toHaveShape({
			content: "foo $(bar) baz",
			quoted: true,
		});
		// inters 已被 revert 清空（避免后续解析阶段二次求值）
		expect(tokens[0]?.inters).toEqual([]);
	});

	it("双引号内的插值正常记录", () => {
		const argv = Argv.parse('"foo $(bar) baz"');
		const tokens = argv.tokens!;
		// 双引号 token 的插值段被记录到 inters，等待执行阶段求值
		expect(tokens[0]?.inters).toHaveShape([
			{ source: "bar", initiator: "$(" },
		]);
		expect(tokens[0]).toHaveShape({ content: "foo  baz" });
	});

	it("未闭合的单引号按普通字符计回 content", () => {
		// 左引号未闭合时作为普通字符保留，插值偏移随之修正
		const argv = Argv.parse("'foo$(bar)");
		expect(argv.tokens![0]).toHaveShape({
			content: "'foo$(bar)",
			quoted: false,
		});
	});

	it("全局 interpolate 注册新的插值语法", () => {
		Argv.interpolate("%", ")");
		try {
			const argv = Argv.parse("a%(echo b)c");
			const tokens = argv.tokens!;
			// "%" 起始、")" 终止的插值段被切出，剩余内容拼回 token
			expect(tokens[0]).toHaveShape({ content: "ac" });
			expect(tokens[0]?.inters).toHaveLength(1);
			expect(tokens[0]?.inters[0]).toHaveShape({
				initiator: "%",
				pos: 1,
			});
		} finally {
			// 清理全局注册，避免污染其它用例
			delete bracs["%"];
		}
	});

	it("实例级 interpolate 仅本实例可见", () => {
		const tokenizer = new Tokenizer();
		tokenizer.interpolate("%", ")");
		// 实例上注册的语法可解析
		const local = tokenizer.parse("x%(y)z");
		expect(local.tokens![0]?.inters).toHaveShape([
			{ initiator: "%" },
		]);
		// 全局默认 tokenizer 不受实例注册影响："%" 不被当作插值
		const global = Argv.parse("x%(y)z");
		expect(global.tokens).toHaveShape([
			{ content: "x%(y)z" },
		]);
		expect(global.tokens![0]?.inters).toEqual([]);
	});

	it("自定义解析器的插值段", () => {
		const tokenizer = new Tokenizer();
		tokenizer.interpolate("%", "", (source) => ({
			source,
			tokens: [
				{
					content: source,
					quoted: true,
					terminator: "",
					inters: [],
				},
			],
		}));
		const argv = tokenizer.parse("a%hello b");
		// 自定义 parse 接管子段解析，子 argv 原样记录进 inters
		expect(argv.tokens![0]?.inters).toHaveShape([
			{ source: "hello b", initiator: "%" },
		]);
	});
});
