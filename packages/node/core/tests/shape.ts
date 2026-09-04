// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 形状断言（bun:test 版，替代原根目录 scripts/testing/chai-shape 内联实现）：
 * 校验目标为期望形状的递归超集——数组仅校验期望侧索引、普通对象按键对齐
 * 递归、其余值深度相等（与上游 chai-shape 语义保持一致）。
 *
 * 用法：测试文件顶部 `import "./shape"`（或相对路径引入）一次以完成注册，
 * 之后即可使用 `expect(actual).toHaveShape(expected)`。
 */
import { expect } from "bun:test";

function isSubsetOf(
	actual: unknown,
	expected: unknown,
): boolean {
	if (expected === actual) return true;
	if (Array.isArray(expected)) {
		if (!Array.isArray(actual)) return false;
		// 超集匹配：仅校验期望侧的索引
		return expected.every((item, index) =>
			isSubsetOf(actual[index], item),
		);
	}
	if (
		typeof expected === "object" &&
		expected !== null &&
		typeof actual === "object" &&
		actual !== null
	) {
		const source = expected as Record<string, unknown>;
		const target = actual as Record<string, unknown>;
		return Object.keys(source).every(
			(key) =>
				key in target &&
				isSubsetOf(target[key], source[key]),
		);
	}
	return false;
}

declare module "bun:test" {
	interface Matchers<T> {
		/** 期望为实际的递归子集（数组按期望侧索引、对象按键） */
		toHaveShape(expected: object): T;
	}
}

expect.extend({
	toHaveShape(actual: unknown, expected: object) {
		return {
			pass: isSubsetOf(actual, expected),
			message: () =>
				`期望目标具有给定形状（期望应为实际的递归子集）\n实际: ${JSON.stringify(actual)}\n期望: ${JSON.stringify(expected)}`,
		};
	},
});
