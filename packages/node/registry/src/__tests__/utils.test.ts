// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * registry 工具集测试：Ensure 系列类型守卫的清洗/回退语义，与
 * conclude() 把 package.json 的 koishi 字段及约定关键词折算成
 * 结构化 Manifest 的各分支。
 */
import { describe, expect, it } from "bun:test";
import type { Manifest, PackageJson } from "../types.ts";
import { conclude, Ensure, mapLimit } from "../utils.ts";

/** 生成最小可用的 package.json 测试载荷 */
function pkg(
	partial: Partial<PackageJson> = {},
): PackageJson {
	return {
		name: "koishi-plugin-test",
		version: "1.0.0",
		description: "",
		keywords: [],
		...partial,
	};
}

describe("Ensure", () => {
	it("array：合法 string[] 原样返回，非字符串元素被过滤", () => {
		expect(Ensure.array(["a", "b"])).toEqual(["a", "b"]);
		expect(Ensure.array(["a", 1, true, null, "b"])).toEqual(
			["a", "b"],
		);
		expect(Ensure.array([])).toEqual([]);
	});

	it("array：非数组输入返回 undefined 或回退值", () => {
		expect(Ensure.array("not-array")).toBeUndefined();
		expect(Ensure.array(undefined)).toBeUndefined();
		expect(Ensure.array(null, ["fallback"])).toEqual([
			"fallback",
		]);
	});

	it("dict：合法字符串字典原样返回，非字符串值的键被丢弃", () => {
		expect(Ensure.dict({ a: "1", b: "2" })).toEqual({
			a: "1",
			b: "2",
		});
		expect(Ensure.dict({ a: 1, b: "2", c: null })).toEqual({
			b: "2",
		});
	});

	it("dict：非对象输入返回 undefined 或回退值", () => {
		expect(Ensure.dict(null)).toBeUndefined();
		expect(Ensure.dict("str")).toBeUndefined();
		expect(
			Ensure.dict(undefined, { fallback: "x" }),
		).toEqual({
			fallback: "x",
		});
	});

	it("boolean/number/string：类型符合原样返回，不符取回退值", () => {
		expect(Ensure.boolean(true)).toBe(true);
		expect(Ensure.boolean("yes", false)).toBe(false);
		expect(Ensure.number(3)).toBe(3);
		expect(Ensure.number("3", 0)).toBe(0);
		expect(Ensure.string("x")).toBe("x");
		expect(Ensure.string(1, "fallback")).toBe("fallback");
	});
});

describe("conclude", () => {
	it("基础清单：description 回退顶层字段，service/locales 默认为空", () => {
		const manifest = conclude(
			pkg({ description: "top-level" }),
		);
		expect(manifest.description).toBe("top-level");
		expect(manifest.locales).toEqual([]);
		expect(manifest.service).toEqual({
			required: [],
			optional: [],
			implements: [],
		});
		// 未提供的可选清单字段不落键
		expect("hidden" in manifest).toBe(false);
		expect("public" in manifest).toBe(false);
	});

	it("koishi.description 优先于顶层 description（多语言字典）", () => {
		const manifest = conclude(
			pkg({
				description: "top",
				koishi: {
					description: { "zh-CN": "中文", en: "English" },
				},
			}),
		);
		expect(manifest.description).toEqual({
			"zh-CN": "中文",
			en: "English",
		});
	});

	it("koishi 字段经 Ensure 清洗后写入，类型不符的不落键", () => {
		const manifest = conclude(
			pkg({
				koishi: {
					hidden: true,
					// preview 故意给类型不符的字符串：验证 Ensure 清洗后不落键（负向载荷，经收窄传入）
					preview: "yes" as unknown as boolean,
					insecure: false,
					browser: true,
					category: "tool",
					public: [".", "./client"],
					locales: ["zh-CN"],
					service: {
						required: ["database"],
						optional: ["console"],
						implements: ["help"],
					},
				},
			}),
		);
		expect(manifest.hidden).toBe(true);
		expect(manifest.preview).toBeUndefined();
		expect(manifest.insecure).toBe(false);
		expect(manifest.browser).toBe(true);
		expect(manifest.category).toBe("tool");
		expect(manifest.public).toEqual([".", "./client"]);
		expect(manifest.locales).toEqual(["zh-CN"]);
		expect(manifest.service).toEqual({
			required: ["database"],
			optional: ["console"],
			implements: ["help"],
		});
	});

	it("字符串描述截断到 1024 字符", () => {
		const manifest = conclude(
			pkg({ description: "x".repeat(2000) }),
		);
		expect(manifest.description).toHaveLength(1024);
		expect(manifest.description).toBe("x".repeat(1024));
	});

	it("koishi.description 仅支持字典形态：字符串时回退顶层 description", () => {
		// 实现现状：Ensure.dict 只认对象，字符串形态的 koishi.description
		// 不被采用，回退到顶层 description（缺省为空串）
		const manifest = conclude(
			pkg({
				description: "top",
				koishi: { description: "ignored" },
			}),
		);
		expect(manifest.description).toBe("top");
	});

	it("多语言字典描述的每个语言值各自截断", () => {
		const manifest = conclude(
			pkg({
				koishi: {
					description: { a: "y".repeat(1500), b: "short" },
				},
			}),
		);
		const dict = manifest.description as Record<
			string,
			string
		>;
		expect(dict["a"]).toHaveLength(1024);
		expect(dict["b"]).toBe("short");
	});

	it("约定关键词折算进清单字段并被剔除，普通关键词保留", () => {
		const meta = pkg({
			keywords: [
				"chatbot",
				"market:hidden",
				"required:database",
				"optional:console",
				"impl:help",
				"locale:zh-CN",
				"weird:kw",
			],
		});
		const manifest = conclude(meta);
		expect(manifest.hidden).toBe(true);
		expect(manifest.service.required).toEqual(["database"]);
		expect(manifest.service.optional).toEqual(["console"]);
		expect(manifest.service.implements).toEqual(["help"]);
		expect(manifest.locales).toEqual(["zh-CN"]);
		// 含 ":" 的关键词（无论是否被识别）一律从 keywords 剔除
		expect(meta.keywords).toEqual(["chatbot"]);
	});

	it("keywords 非数组时回退为空数组", () => {
		const meta = pkg({
			keywords: "bad" as unknown as string[],
		});
		const manifest = conclude(meta);
		expect(meta.keywords).toEqual([]);
		expect(manifest.hidden).toBeUndefined();
	});

	it("返回完整 Manifest 形态（描述缺省时为空串）", () => {
		const manifest: Manifest = conclude(pkg());
		expect(manifest).toEqual({
			description: "",
			locales: [],
			service: {
				required: [],
				optional: [],
				implements: [],
			},
		});
	});
});
describe("mapLimit", () => {
	it("保序返回全部结果（含真实 undefined 元素不跳过后继任务）", async () => {
		const calls: number[] = [];
		const result = await mapLimit(
			[1, undefined, 3] as const,
			2,
			(item, index) => {
				calls.push(index);
				return item === undefined ? undefined : item * 2;
			},
		);
		// 索引 2 不被索引 1 的 undefined 提前截断
		expect(result).toEqual([2, undefined, 6]);
		expect(calls).toEqual([0, 1, 2]);
	});

	it("并发数受限：同时执行不超过 concurrency 个 mapper", async () => {
		let active = 0;
		let peak = 0;
		await mapLimit([0, 1, 2, 3, 4, 5], 2, async (item) => {
			active += 1;
			peak = Math.max(peak, active);
			await new Promise((resolve) =>
				setTimeout(resolve, 5),
			);
			active -= 1;
			return item;
		});
		expect(peak).toBe(2);
	});

	it("并发数归一化：0 / 负数 / NaN 按 1，Infinity 退化为任务数", async () => {
		expect(await mapLimit([1, 2], 0, (x) => x)).toEqual([
			1, 2,
		]);
		expect(await mapLimit([1, 2], -1, (x) => x)).toEqual([
			1, 2,
		]);
		expect(
			await mapLimit([1, 2], Number.NaN, (x) => x),
		).toEqual([1, 2]);
		expect(
			await mapLimit(
				[1, 2],
				Number.POSITIVE_INFINITY,
				(x) => x,
			),
		).toEqual([1, 2]);
	});

	it("空数组直接返回空结果", async () => {
		expect(await mapLimit([], 5, (x) => x)).toEqual([]);
	});

	it("mapper 抛错：整体 reject 且不再派发新任务", async () => {
		const calls: number[] = [];
		const task = mapLimit([0, 1, 2, 3], 1, (item) => {
			calls.push(item);
			if (item === 1) throw new Error("boom");
			return item;
		});
		await expect(task).rejects.toThrow("boom");
		// 并发 1 串行：失败后停止，不派发索引 2 / 3
		expect(calls).toEqual([0, 1]);
	});

	it("mapper 异步拒绝同样被消化（无 unhandled rejection）并整体 reject", async () => {
		const task = mapLimit([0, 1], 2, async (item) => {
			await new Promise((resolve) =>
				setTimeout(resolve, 1),
			);
			if (item === 1) throw new Error("async boom");
			return item;
		});
		await expect(task).rejects.toThrow("async boom");
	});

	it("mapper 抛出 undefined 不被吞掉：整体 reject 且不再派发新任务", async () => {
		const calls: number[] = [];
		const task = mapLimit([0, 1, 2, 3], 1, (item) => {
			calls.push(item);
			// throw undefined 是合法 JS，原因值本身为空也必须视为失败
			if (item === 1) throw undefined;
			return item;
		});
		// rejects.toBeUndefined()：断言整体以 undefined 原因 reject
		let rejected = false;
		try {
			await task;
		} catch (error) {
			rejected = true;
			expect(error).toBeUndefined();
		}
		expect(rejected).toBe(true);
		// 并发 1 串行：失败后停止，不派发索引 2 / 3
		expect(calls).toEqual([0, 1]);
	});

	it("首个失败优先：后发错误不覆盖首次错误原因", async () => {
		const task = mapLimit([0, 1], 2, async (item) => {
			await new Promise((resolve) =>
				setTimeout(resolve, item === 0 ? 3 : 1),
			);
			throw new Error(`boom-${item}`);
		});
		// 并发 2：延迟 1ms 的 item 1 先失败，延迟 3ms 的 item 0 后失败；
		// 后者不得覆盖已记录的首次错误原因
		await expect(task).rejects.toThrow("boom-1");
	});
});
