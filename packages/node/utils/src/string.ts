// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 字符串工具：模板插值与正则转义。
 *
 * interpolate 是 Koishi 配置文件中 `${{ expr }}` / `{{ expr }}`
 * 表达式求值的底层实现，基于 Function 构造器 + with 作用域求值；
 * escapeRegExp 用于把任意字符串安全嵌入正则表达式字面量。
 */

// eslint-disable-next-line no-new-func
const evaluate = new Function(
	"context",
	"expr",
	`
  try {
    with (context) {
      return eval(expr)
    }
  } catch {}
`,
) as (context: object, expr: string) => unknown;

/**
 * 对模板字符串中的 `{{ expr }}` 占位符求值并替换。
 *
 * - 整个字符串恰为一个占位符时，直接返回求值结果的原始类型（可非字符串）；
 * - 否则求值结果以字符串形式拼接；求值失败或结果为空值时替换为空串。
 *
 * 扫描用单调前进的 indexOf 实现（定界符成对查找），
 * 不使用带回溯的正则，避免模板含大量 `{` 时的平方级回溯。
 *
 * @param template 模板字符串
 * @param context 表达式求值的作用域对象
 * @param start 占位符起始定界符（默认 `{{`）
 * @param end 占位符结束定界符（默认 `}}`）
 */
export function interpolate(
	template: string,
	context: object,
	start = "{{",
	end = "}}",
): unknown {
	let result = "";
	let from = 0;
	let index = template.indexOf(start);
	while (index >= 0) {
		const close = template.indexOf(
			end,
			index + start.length,
		);
		// 无闭合定界符：剩余部分原样保留
		if (close < 0) break;
		const content = template.slice(
			index + start.length,
			close,
		);
		if (!content) {
			// 空内容不构成占位符（原 `+?` 量词要求至少一个字符），从下一字符继续找
			index = template.indexOf(start, index + 1);
			continue;
		}
		// 整串就是单个占位符：保留求值结果的原始类型
		if (
			index === 0 &&
			close + end.length === template.length
		) {
			return evaluate(context, content);
		}
		result += template.slice(from, index);
		result += String(evaluate(context, content) ?? "");
		from = close + end.length;
		index = template.indexOf(start, from);
	}
	return result + template.slice(from);
}

/**
 * 转义字符串中的正则特殊字符，使其可作为字面量安全嵌入正则。
 * 连字符转义为 \x2d 以避免被误解析为字符类范围（即便脱离 [...] 上下文）。
 */
export function escapeRegExp(source: string) {
	return source
		.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&")
		.replace(/-/g, "\\x2d");
}
