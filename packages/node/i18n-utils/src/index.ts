// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * i18n 辅助：语言环境树与回退序列计算。
 *
 * LocaleTree 把形如 zh-CN / zh-TW / en-US 的语言环境按 `-` 逐级拆解为
 * 嵌套树（zh -> zh-CN / zh-TW）；fallback() 再依据用户偏好的语言列表
 * 计算出查找顺序，优先精确匹配，逐级向语言主代码回退，最后兜底到全部
 * 可用语言。供控制台与客户端本地化模块复用。
 */

// 确保函数签名与 @intlify/core-base 保持兼容
import { deduplicate } from "cosmokit";

/** 语言环境树：每个键（语言环境名）指向其子语言环境构成的子树 */
export type LocaleTree = { [key in string]: LocaleTree };

// 值侧与同名类型合并声明,保持上游 API
export const LocaleTree = {
	/**
	 * 由语言环境列表构造语言环境树：按 `-` 逐级展开层级。
	 * 例如 ["zh-CN", "zh-TW"] 得到 { zh: { "zh-CN": {}, "zh-TW": {} } }。
	 */
	from(locales: string[]) {
		// null 原型对象：locale 片段来自外部字符串，防止 "__proto__" 等
		// 保留键在普通对象上触发原型链存取器造成原型污染
		const tree: LocaleTree = Object.create(null);
		for (const locale of locales.filter(Boolean)) {
			const tokens = locale.split("-");
			let current = tree;
			for (let i = 0; i < tokens.length; i++) {
				const locale = tokens.slice(0, i + 1).join("-");
				current = current[locale] ||= Object.create(null);
			}
		}
		return tree;
	},
};

/** 树节点的工作形态：[语言环境名, 子节点列表]（首子节点为自身，允许整树回退到父级） */
type LocaleEntry = readonly [string, LocaleEntry[]];

/** 把 LocaleTree 递归转换为带自身引用的 LocaleEntry 结构 */
function toLocaleEntry(key: string, tree: LocaleTree): LocaleEntry {
	return [
		key,
		[
			[key, []],
			...Object.entries(tree).map(([key, value]) => toLocaleEntry(key, value)),
		],
	];
}

/**
 * 深度优先遍历树节点，产出叶子（及无未忽略子节点的节点）对应的语言环境名。
 * ignored 中的节点已被更高优先级消费，跳过以避免重复。
 */
function* traverse(
	[key, children]: LocaleEntry,
	ignored: LocaleEntry[],
): Generator<string> {
	if (!children.length) {
		return yield key;
	}
	for (const child of children) {
		if (ignored.includes(child)) continue;
		yield* traverse(child, ignored);
	}
}

/**
 * 依据用户偏好的语言列表计算回退查找顺序。
 *
 * 处理方式（locales 从后往前、后者优先）：
 * 沿每个语言环境的层级路径把对应节点上移到同级首位（优先匹配），
 * 并把命中的完整环境加入忽略表；最终从各命中节点到根遍历，
 * 产出"精确环境 -> 各级父语言 -> 根 -> 其余语言"的有序列表。
 *
 * @param tree 全部可用语言构成的树（见 LocaleTree.from）
 * @param locales 用户偏好的语言环境列表（按优先级升序，末尾优先级最高）
 * @returns 去重后的回退查找顺序
 */
export function fallback(tree: LocaleTree, locales: string[]): string[] {
	const root = toLocaleEntry("", tree);
	const ignored: LocaleEntry[] = [];
	// 倒序处理偏好列表：越靠后的优先级越高，unshift 保证其排在 ignored 前列
	for (const locale of deduplicate(locales).filter(Boolean).reverse()) {
		let prefix = "",
			children = root[1];
		const tokens = locale ? locale.split("-") : [];
		for (const token of tokens) {
			const current = prefix + token;
			const entry = children.find(([key]) => key === current);
			if (!entry) break;
			// 把命中节点上移到同级首位，使后续遍历优先产出该分支
			const index = children.indexOf(entry);
			if (index > 0) {
				children.splice(index, 1);
				children.unshift(entry);
			}
			children = entry[1];
			prefix = `${current}-`;
			if (current === locale) {
				ignored.unshift(entry);
			}
		}
	}
	// 根节点作为最终兜底（"" 在序列化结果中表示空环境名）
	ignored.push(root);
	const results: string[] = [];
	for (const entry of ignored) {
		results.push(...traverse(entry, ignored));
	}
	return results;
}
