import { describe, it } from "bun:test";
import { expect } from "chai";
import { fallback, LocaleTree } from "./index";

/** i18n-utils（语言环境树与回退序列）的单元测试 */
describe("@koishi-ce/i18n-utils", () => {
	// 验证 LocaleTree.from 按 `-` 正确逐级展开为嵌套树
	it("locale tree", () => {
		expect(LocaleTree.from(["zh-CN", "zh-TW", "en-US", "en-GB"])).to.deep.equal(
			{
				zh: { "zh-CN": {}, "zh-TW": {} },
				en: { "en-US": {}, "en-GB": {} },
			},
		);
	});

	// 验证单个偏好语言时的回退顺序：精确匹配 -> 父语言 -> 同级其它 -> 根兜底
	it("single fallbacking", () => {
		expect(
			fallback(
				{
					zh: { "zh-CN": {}, "zh-TW": {} },
					en: { "en-US": {}, "en-GB": {} },
				},
				["zh-TW"],
			),
		).to.deep.equal(["zh-TW", "zh", "zh-CN", "", "en", "en-US", "en-GB"]);

		expect(
			fallback(
				{
					zh: { "zh-CN": {}, "zh-TW": {} },
					en: { "en-US": {}, "en-GB": {} },
				},
				["en"],
			),
		).to.deep.equal(["en", "en-US", "en-GB", "", "zh", "zh-CN", "zh-TW"]);

		expect(
			fallback(
				{
					zh: { "zh-CN": {}, "zh-TW": {} },
					en: { "en-US": {}, "en-GB": {} },
				},
				[],
			),
		).to.deep.equal(["", "zh", "zh-CN", "zh-TW", "en", "en-US", "en-GB"]);

		expect(
			fallback(
				{
					zh: { "zh-CN": {}, "zh-TW": {} },
					en: { "en-US": {}, "en-GB": {} },
				},
				["de-DE"],
			),
		).to.deep.equal(["", "zh", "zh-CN", "zh-TW", "en", "en-US", "en-GB"]);
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
		).to.deep.equal(["en", "en-US", "en-GB", "zh-TW", "zh", "zh-CN", ""]);

		expect(
			fallback(
				{
					zh: { "zh-CN": {}, "zh-TW": {} },
					en: { "en-US": {}, "en-GB": {} },
				},
				["zh-TW", "zh-TW-XX", "en"],
			),
		).to.deep.equal(["zh-TW", "en", "en-US", "en-GB", "zh", "zh-CN", ""]);

		expect(
			fallback(
				{
					zh: { "zh-CN": {}, "zh-TW": {} },
					en: { "en-US": {}, "en-GB": {} },
				},
				["en", "de-DE", "en-GB"],
			),
		).to.deep.equal(["en", "en-US", "en-GB", "", "zh", "zh-CN", "zh-TW"]);

		expect(
			fallback(
				{
					zh: { "zh-CN": {}, "zh-TW": {} },
					en: { "en-US": {}, "en-GB": {} },
				},
				["en-GB", "zh-CN", "en"],
			),
		).to.deep.equal(["en-GB", "zh-CN", "en", "en-US", "zh", "zh-TW", ""]);
	});
});
