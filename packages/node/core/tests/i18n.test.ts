// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * i18n 服务与模式匹配工具补充测试。
 *
 * 覆盖 compare 的相似度阈值（配置默认与显式选项）、get 的语言回退、
 * find 的跨语言模糊查找与捕获参数、createMatch 的空捕获组跳过
 * 与多捕获组提取。
 */
import { describe, expect, it } from "bun:test";
import { App, createMatch } from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";
import "./shape.ts";

const app = new App({ minSimilarity: 0.5 });
app.plugin(mock);

app.i18n.define("zh-CN", {
	fruits: { apple: "苹果", banana: "香蕉" },
});
app.i18n.define("en-US", {
	fruits: { apple: "apple" },
});

describe("I18n Service", () => {
	it("compare 按阈值判定相似度", () => {
		// 完全一致相似度为 1
		expect(app.i18n.compare("苹果", "苹果")).toBe(1);
		// 距离 2 / 长度 2 = 0，低于配置阈值
		expect(app.i18n.compare("苹果", "梨子")).toBe(0);
		expect(app.i18n.compare("苹果", "苹果梨")).toBe(0.5);
		// 显式选项覆盖配置阈值：0.25 低于默认 0.5 但达到 0.1
		expect(app.i18n.compare("abcd", "a")).toBe(0);
		expect(
			app.i18n.compare("abcd", "a", { minSimilarity: 0.1 }),
		).toBe(0.25);
	});

	it("get 按语言回退取模板", () => {
		const result = app.i18n.get("fruits.apple", ["zh-CN"]);
		// 偏好语言排在最前，其后按配置回退链命中已定义语言
		expect(Object.keys(result)[0]).toBe("zh-CN");
		expect(result).toHaveShape({
			"zh-CN": "苹果",
			"en-US": "apple",
		});
		// 未指定语言时按配置列表回退，仅命中已定义的语言
		expect(app.i18n.get("fruits.banana")).toEqual({
			"zh-CN": "香蕉",
		});
		expect(app.i18n.get("fruits.missing")).toEqual({});
	});

	it("find 跨语言模糊查找并捕获参数", () => {
		const results = app.i18n.find("fruits.(name)", "莘果");
		// 中文模板相似度 0.5 达标；英文模板不相似被过滤
		expect(results).toHaveLength(1);
		expect(results[0]).toHaveShape({
			locale: "zh-CN",
			data: { name: "apple" },
		});
		expect(results[0]?.similarity).toBe(0.5);
		// 完全不相似时无结果
		expect(
			app.i18n.find("fruits.(name)", "zzzzzz"),
		).toEqual([]);
	});
});

describe("createMatch", () => {
	it("空捕获组不参与匹配", () => {
		const match = createMatch("a()b");
		// "()" 被跳过，模式等价于字面量 "ab"（推断类型未剔除空名捕获组，按 object 视图断言）
		expect(match("ab") as object).toEqual({});
		expect(match("axb")).toBeUndefined();
	});

	it("多捕获组按顺序提取", () => {
		const match = createMatch(
			"commands.(name).options.(key)",
		);
		expect(match("commands.foo.options.bar")).toEqual({
			name: "foo",
			key: "bar",
		});
		expect(match("commands.foo")).toBeUndefined();
	});
});
