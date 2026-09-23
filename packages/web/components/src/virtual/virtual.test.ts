// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

import { describe, expect, test } from "bun:test";
import Virtual from "./virtual.ts";

// 回归防护：构造函数必须立即写入初始渲染区间。
// 曾因 checkRange 的 start 相等守卫（初始 start 已是 0）跳过首次
// updateRange，导致 end 停留在 0、虚拟列表首屏渲染为空。
describe("Virtual 初始渲染区间", () => {
	test("数据量不超过可视条数时全量渲染", () => {
		const virtual = new Virtual({
			count: 300,
			estimated: 50,
			buffer: 100,
			uids: ["a", "b", "c"],
		});
		expect(virtual.range.start).toBe(0);
		expect(virtual.range.end).toBe(3);
	});

	test("数据量超过可视条数时只渲染一个窗口", () => {
		const uids = Array.from(
			{ length: 10 },
			(_, i) => `item-${i}`,
		);
		const virtual = new Virtual({
			count: 5,
			estimated: 50,
			buffer: 1,
			uids,
		});
		expect(virtual.range.start).toBe(0);
		expect(virtual.range.end).toBe(5);
	});

	test("初始区间随 uids 变化可被 handleDataChange 修正", () => {
		const virtual = new Virtual({
			count: 300,
			estimated: 50,
			buffer: 100,
			uids: ["a", "b", "c"],
		});
		virtual.updateUids(["a", "b", "c", "d", "e"]);
		virtual.handleDataChange();
		expect(virtual.range.end).toBe(5);
	});
});
