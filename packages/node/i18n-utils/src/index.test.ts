// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { describe, expect, it } from "bun:test";
import { fallback, LocaleTree } from "./index.ts";

/** i18n-utils（语言环境树与回退序列）的单元测试 */
describe("@koishi-ce/i18n-utils", () => {
	// 验证 LocaleTree.from 按 `-` 正确逐级展开为嵌套树
	it("locale tree", () => {
		expect(
			LocaleTree.from(["zh-CN", "zh-TW", "en-US", "en-GB"]),
		).toEqual({
			zh: { "zh-CN": {}, "zh-TW": {} },
			en: { "en-US": {}, "en-GB": {} },
		});
	});

	// 验证单个偏好语言时的回退顺序：精确匹配 -> 同分支更特异/更泛化 ->
	// 其余分支（各分支内特异优先）-> 根兜底
	it("single fallbacking", () => {
		expect(
			fallback(
				{
					zh: { "zh-CN": {}, "zh-TW": {} },
					en: { "en-US": {}, "en-GB": {} },
				},
				["zh-TW"],
			),
		).toEqual([
			"zh-TW",
			"zh-CN",
			"zh",
			"en-US",
			"en-GB",
			"en",
			"",
		]);

		expect(
			fallback(
				{
					zh: { "zh-CN": {}, "zh-TW": {} },
					en: { "en-US": {}, "en-GB": {} },
				},
				["en"],
			),
		).toEqual([
			"en-US",
			"en-GB",
			"en",
			"zh-CN",
			"zh-TW",
			"zh",
			"",
		]);

		expect(
			fallback(
				{
					zh: { "zh-CN": {}, "zh-TW": {} },
					en: { "en-US": {}, "en-GB": {} },
				},
				[],
			),
		).toEqual([
			"zh-CN",
			"zh-TW",
			"zh",
			"en-US",
			"en-GB",
			"en",
			"",
		]);

		expect(
			fallback(
				{
					zh: { "zh-CN": {}, "zh-TW": {} },
					en: { "en-US": {}, "en-GB": {} },
				},
				["de-DE"],
			),
		).toEqual([
			"zh-CN",
			"zh-TW",
			"zh",
			"en-US",
			"en-GB",
			"en",
			"",
		]);
	});

	// 验证多个偏好语言叠加时的回退顺序：末位优先、重复与未命中环境的处理
	it("multiple fallbacking", () => {
		expect(
			fallback(
				{
					zh: { "zh-CN": {}, "zh-TW": {} },
					en: { "en-US": {}, "en-GB": {} },
				},
				["en", "zh-TW"],
			),
		).toEqual([
			"en-US",
			"en-GB",
			"en",
			"zh-TW",
			"zh-CN",
			"zh",
			"",
		]);

		expect(
			fallback(
				{
					zh: { "zh-CN": {}, "zh-TW": {} },
					en: { "en-US": {}, "en-GB": {} },
				},
				["zh-TW", "zh-TW-XX", "en"],
			),
		).toEqual([
			"zh-TW",
			"en-US",
			"en-GB",
			"en",
			"zh-CN",
			"zh",
			"",
		]);

		expect(
			fallback(
				{
					zh: { "zh-CN": {}, "zh-TW": {} },
					en: { "en-US": {}, "en-GB": {} },
				},
				["en", "de-DE", "en-GB"],
			),
		).toEqual([
			"en-US",
			"en",
			"en-GB",
			"zh-CN",
			"zh-TW",
			"zh",
			"",
		]);

		expect(
			fallback(
				{
					zh: { "zh-CN": {}, "zh-TW": {} },
					en: { "en-US": {}, "en-GB": {} },
				},
				["en-GB", "zh-CN", "en"],
			),
		).toEqual([
			"en-GB",
			"zh-CN",
			"en-US",
			"en",
			"zh-TW",
			"zh",
			"",
		]);
	});
});
