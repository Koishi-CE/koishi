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
) as (context: object, expr: string) => any;

/**
 * 对模板字符串中的 `{{ expr }}`（或自定义 pattern）占位符求值并替换。
 *
 * - 整个字符串恰为一个占位符时，直接返回求值结果的原始类型（可非字符串）；
 * - 否则求值结果以字符串形式拼接；求值失败或结果为空值时替换为空串。
 *
 * @param template 模板字符串
 * @param context 表达式求值的作用域对象
 * @param pattern 占位符匹配正则（默认 `{{ ... }}`）
 */
export function interpolate(
	template: string,
	context: object,
	pattern = /\{\{([\s\S]+?)\}\}/g,
) {
	let capture: RegExpExecArray | null;
	let result = "",
		lastIndex = 0;
	while ((capture = pattern.exec(template))) {
		// 整串就是单个占位符：保留求值结果的原始类型
		if (capture[0] === template) {
			return evaluate(context, capture[1] ?? "");
		}
		result += template.slice(lastIndex, capture.index);
		result += evaluate(context, capture[1] ?? "") ?? "";
		lastIndex = capture.index + capture[0].length;
	}
	return result + template.slice(lastIndex);
}

/**
 * 转义字符串中的正则特殊字符，使其可作为字面量安全嵌入正则。
 * 连字符转义为 \x2d 以避免被误解析为字符类范围（即便脱离 [...] 上下文）。
 */
export function escapeRegExp(source: string) {
	return source.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d");
}
