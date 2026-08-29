/**
 * i18n 的模式匹配工具。
 *
 * 把带捕获组的模式串（如 `authority:(value)`、`commands.(name).messages`）
 * 编译成正则，用于两处：
 * - 权限系统：权限名模板的匹配与参数捕获（见 permission.ts）；
 * - 指令纠错：遍历全部文案路径，找出与用户输入相近的条目（findMatches）。
 */
import type { I18n } from "./index";

/** 模糊比对选项。 */
export interface CompareOptions {
	/** 相似度阈值（0~1），低于阈值视为不匹配 */
	minSimilarity?: number;
}

/** 递归提取模式串中所有 `(...)` 捕获组名的联合类型。 */
type GroupNames<
	P extends string,
	K extends string = never,
> = P extends `${string}(${infer R})${infer S}` ? GroupNames<S, K | R> : K;

/** 匹配结果：捕获组名到捕获值的映射（类型由模式串字面量推导）。 */
export type MatchResult<P extends string = never> = Record<
	GroupNames<P>,
	string
>;

/**
 * 编译模式串为匹配函数。
 *
 * 形如 `a.(name).b` 的模式中每个 `(...)` 被替换为贪婪捕获组 `(.+)`，
 * 组名记录在闭包数组里；匹配失败返回 undefined，成功返回 { 组名: 值 }。
 * 注意：模式段之间的字面部分必须完整出现，捕获组要求至少一个字符。
 */
export function createMatch<P extends string>(
	pattern: P,
): (string: string) => undefined | MatchResult<P> {
	const groups: string[] = [];
	// 捕获组替换用单调前进的 indexOf 扫描实现：
	// 带回溯的 `/\(([^)]+)\)/g` 在连续 '(' 输入下是平方级复杂度
	let source = "";
	let from = 0;
	let index = pattern.indexOf("(");
	while (index >= 0) {
		const close = pattern.indexOf(")", index + 1);
		if (close < index + 2) {
			// 空捕获组不参与匹配（原 `[^)]+` 要求至少一个字符），从下一字符继续找
			index = pattern.indexOf("(", index + 1);
			continue;
		}
		groups.push(pattern.slice(index + 1, close));
		source += `${pattern.slice(from, index)}(.+)`;
		from = close + 1;
		index = pattern.indexOf("(", from);
	}
	source += pattern.slice(from);
	const regexp = new RegExp(`^${source}$`);
	return (string: string) => {
		const capture = regexp.exec(string);
		if (!capture) return;
		const data: Record<string, string> = {};
		for (const [i, name] of groups.entries()) {
			// 匹配成功时每个捕获组必有值（(.+) 至少吞掉一个字符）
			data[name] = capture[i + 1] as string;
		}
		return data as MatchResult<P>;
	};
}

/**
 * 在全部语言的全部文案路径中查找与 actual 相近的匹配。
 *
 * 遍历 i18n._data，凡路径能被 pattern 匹配、且对应模板与 actual 的
 * 相似度达阈值的条目都收入结果（含语言、捕获组、相似度），
 * 供指令纠错建议（session.suggest）等场景挑选。
 */
export function findMatches<P extends string>(
	i18n: I18n,
	pattern: P,
	actual: string,
	options: CompareOptions = {},
): I18n.FindResult<P>[] {
	if (!actual) return [];
	const match = createMatch(pattern);
	const results: I18n.FindResult<P>[] = [];
	for (const locale in i18n._data) {
		for (const path in i18n._data[locale]) {
			const data = match(path);
			if (!data) continue;
			const expect = i18n._data[locale][path];
			if (typeof expect !== "string") continue;
			const similarity = i18n.compare(expect, actual, options);
			if (!similarity) continue;
			results.push({ locale, data, similarity });
		}
	}
	return results;
}
