import type { Assertion, ChaiPlugin } from "chai";

// chai-shape 的等价最小实现(上游包未跟进 chai 6):校验目标对象为
// 期望形状的超集,数组按索引对齐、普通对象按键对齐,其余值深度相等
function isSubsetOf(actual: any, expected: any): boolean {
	if (expected === actual) return true;
	if (Array.isArray(expected)) {
		if (!Array.isArray(actual)) return false;
		// 超集匹配:仅校验期望侧的索引(与上游 chai-shape 语义一致)
		return expected.every((item, i) => isSubsetOf(actual[i], item));
	}
	if (
		expected &&
		actual &&
		typeof expected === "object" &&
		typeof actual === "object"
	) {
		return Object.keys(expected).every(
			(key) => key in actual && isSubsetOf(actual[key], expected[key]),
		);
	}
	return false;
}

export const shape: ChaiPlugin = (chai) => {
	const { Assertion } = chai as any;
	Assertion.addMethod("shape", function (this: Assertion, expected: object) {
		const actual = (this as any)._obj;
		this.assert(
			isSubsetOf(actual, expected),
			"expected #{this} to have shape #{exp}",
			"expected #{this} not to have shape #{exp}",
			expected,
			actual,
		);
	});
};
