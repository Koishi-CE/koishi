import { describe, expect, it } from "vitest";

/**
 * @file 行内 markdown 语法特征检测的单元测试。
 *
 * 覆盖:各语法族(强调/代码/链接/删除线/自动链接/HTML/行首块级语法)的
 * 命中,纯文本(含易混淆的数学乘号、词内下划线、尖括号比较、单竖线)的
 * 不误报(词内下划线按"从宽"约定允许命中),以及空输入短路。
 */

import { looksLikeMarkdown } from "../inline-markdown";

describe("looksLikeMarkdown 语法命中", () => {
	it("强调:星号与下划线(单/双)", () => {
		expect(looksLikeMarkdown("这是*强调*文本")).toBe(true);
		expect(looksLikeMarkdown("这是**粗体**文本")).toBe(true);
		expect(looksLikeMarkdown("这是_强调_文本")).toBe(true);
		expect(looksLikeMarkdown("这是__粗体__文本")).toBe(true);
	});

	it("行内代码与代码块", () => {
		expect(looksLikeMarkdown("用 `ctx.command()` 注册")).toBe(true);
		expect(looksLikeMarkdown("```\ncode\n```")).toBe(true);
	});

	it("链接与图片", () => {
		expect(looksLikeMarkdown("见[文档](https://koishi.chat)")).toBe(true);
		expect(looksLikeMarkdown("![示意图](https://example.com/a.png)")).toBe(
			true,
		);
	});

	it("删除线与尖括号自动链接", () => {
		expect(looksLikeMarkdown("~~废弃~~")).toBe(true);
		expect(looksLikeMarkdown("访问 <https://koishi.chat> 查看")).toBe(true);
	});

	it("HTML 标签(marked 透传)", () => {
		expect(looksLikeMarkdown("第一行<br>第二行")).toBe(true);
		expect(looksLikeMarkdown("H<sub>2</sub>O")).toBe(true);
	});

	it("行首块级语法:标题/列表/引用", () => {
		expect(looksLikeMarkdown("## 特性\n跨平台")).toBe(true);
		expect(looksLikeMarkdown("前置说明\n- 项目一\n- 项目二")).toBe(true);
		expect(looksLikeMarkdown("1. 步骤一\n2. 步骤二")).toBe(true);
		expect(looksLikeMarkdown("> 引用他人说明")).toBe(true);
	});
});

describe("looksLikeMarkdown 纯文本不误报", () => {
	it("常见纯文本描述", () => {
		expect(looksLikeMarkdown("一个支持多平台的机器人框架")).toBe(false);
		expect(looksLikeMarkdown("Koishi chatbot framework v4")).toBe(false);
		expect(looksLikeMarkdown("支持 OneBot 11 / 12 协议")).toBe(false);
	});

	it("数学乘号与不成对符号", () => {
		expect(looksLikeMarkdown("3 * 4 = 12")).toBe(false);
		expect(looksLikeMarkdown("单个 ` 反引号")).toBe(false);
	});

	it("成对下划线命中(误报无害:marked 对词内/空格间隔不产生强调,输出仍为原文)", () => {
		expect(looksLikeMarkdown("a _ b _ c")).toBe(true);
		expect(looksLikeMarkdown("foo_bar_baz")).toBe(true);
	});

	it("尖括号比较与邮箱形状", () => {
		expect(looksLikeMarkdown("a < b 且 c > d")).toBe(false);
		expect(looksLikeMarkdown("<3 爱心")).toBe(false);
	});

	it("空与短输入短路", () => {
		expect(looksLikeMarkdown("")).toBe(false);
	});
});
