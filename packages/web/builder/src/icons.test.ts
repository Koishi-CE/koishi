// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * stripLeadingSvgComments（根元素前注释剥除）的单元测试。
 *
 * 图标 .svg 资产的许可头注释位于 <svg> 之前：注释一旦进入组件模板根层，
 * 图标就会变成多根 fragment，prod 运行时丢弃外部传入的 class（透传
 * 断裂）。@iconify/utils 目前已在 getCustomIcon 里切掉 `<svg` 之前的
 * 内容，本函数是 loader 层兜底。此处验证剥除逻辑的边界：许可头剥离、
 * 无注释原样、svg 内部注释保留、注释后置空行。
 */

import { describe, expect, it } from "bun:test";
import { stripLeadingSvgComments } from "./icons.ts";

describe("stripLeadingSvgComments", () => {
	it("剥除根元素前的多行许可头注释", () => {
		const svg = [
			"<!-- SPDX-License-Identifier: AGPL-3.0-only -->",
			"<!-- Copyright (c) 2026-present Koishi-CE contributors. -->",
			"",
			'<svg class="k-icon" viewBox="0 0 448 512">',
			'  <path d="M0 0" />',
			"</svg>",
		].join("\n");
		expect(stripLeadingSvgComments(svg)).toBe(
			'<svg class="k-icon" viewBox="0 0 448 512">\n  <path d="M0 0" />\n</svg>',
		);
	});

	it("无注释的 svg 原样返回", () => {
		const svg =
			'<svg viewBox="0 0 512 512"><path d="M0 0" /></svg>';
		expect(stripLeadingSvgComments(svg)).toBe(svg);
	});

	it("保留 svg 根元素内部的注释（不影响单根性）", () => {
		const svg = [
			"<!-- 头部注释 -->",
			'<svg viewBox="0 0 512 512">',
			"  <!-- 内部注释 -->",
			'  <path d="M0 0" />',
			"</svg>",
		].join("\n");
		const result = stripLeadingSvgComments(svg);
		expect(result).toContain("<!-- 内部注释 -->");
		expect(result.startsWith("<svg")).toBe(true);
	});

	it("容忍注释与根元素之间的空白与连续注释段", () => {
		const svg =
			'  <!-- a -->\n\t<!-- b -->  \n<!-- c --><svg viewBox="0 0 1 1" />';
		expect(stripLeadingSvgComments(svg)).toBe(
			'<svg viewBox="0 0 1 1" />',
		);
	});
});
