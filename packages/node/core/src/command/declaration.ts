/**
 * 命令定义串的解析与值转换。
 *
 * - parseDecl：解析 "<foo> [bar:text]" 形式的声明为 Declaration 列表，
 *   并产出剥离类型标注的 stripped 展示形式；
 * - resolveDomain：把类型标注（内置名 / 正则 / 枚举 / 函数 / 配置对象）
 *   统一归一为 DomainConfig；
 * - parseValue：调用 domain 的 transform 做类型强转，失败时把
 *   用户可读的错误文案写入 argv.error（不抛异常）。
 */

import type { Context } from "../context";
import type { Argv } from "./parser";

// https://github.com/microsoft/TypeScript/issues/17002
// 上游 TS 缺陷长期未修：内置 Array.isArray 对含 readonly 数组的联合类型
// 会把 false 分支也收窄进数组，只能用 unknown 版谓词断言绕过
const isArray = Array.isArray as (arg: unknown) => arg is readonly unknown[];

// 匹配声明中的一段参数：<...>（必填）或 [...]（可选）
const BRACKET_REGEXP = /<[^>]+>|\[[^\]]+\]/g;

/** parseDecl 的产出：声明列表 + 剥离类型标注后的展示形式 */
export interface DeclarationList extends Array<Argv.Declaration> {
	/** 原始声明串；贪婪类型（如 text）的标注替换为 "..."，其余类型标注删除 */
	stripped: string;
}

/**
 * 把类型标注归一为 DomainConfig。
 * 函数 / 正则 / 枚举数组按字面量构造 transform；对象视作完整配置；
 * 字符串视为内置 domain 名，从 ctx 服务表（domain:<name>）查询。
 */
export function resolveDomain(ctx: Context, type: Argv.Type | undefined) {
	if (typeof type === "function") {
		return { transform: type };
	} else if (type instanceof RegExp) {
		const transform = (source: string) => {
			if (type.test(source)) return source;
			throw new Error();
		};
		return { transform };
	} else if (isArray(type)) {
		const transform = (source: string) => {
			if (type.includes(source)) return source;
			throw new Error();
		};
		return { transform };
	} else if (typeof type === "object") {
		return type ?? {};
	}
	return ctx.get(`domain:${type}`) ?? {};
}

/**
 * 按声明的类型把原始字符串强转为实际取值。
 *
 * @param kind 出错文案的类型段："argument" 或 "option"
 * 转换抛错时不向上传播：有会话时组装本地化的错误提示
 * （优先用 domain 抛出的错误键，否则用通用语法文案），
 * 无会话时退回裸键名。
 */
export function parseValue(
	ctx: Context,
	source: string,
	kind: string,
	argv: Argv,
	decl: Argv.Declaration = {},
) {
	const { name, type = "string" } = decl;

	// 调用 domain 的转换函数执行强转
	const domain = resolveDomain(ctx, type);
	try {
		return domain.transform(source, argv.session);
	} catch (err) {
		if (!argv.session) {
			argv.error = `internal.invalid-${kind}`;
		} else {
			const message = argv.session.text(
				(err as Error).message || "internal.check-syntax",
			);
			argv.error = argv.session.text(`internal.invalid-${kind}`, [
				name,
				message,
			]);
		}
	}
}

/**
 * 解析定义串中的参数声明。
 *
 * 语法：`<name:type>` 必填、`[name:type]` 可选、`...name` 变长；
 * stripped 为去掉类型标注（贪婪类型保留 "..."）后的展示形式，
 * 供 help 与选项语法串拼接使用。
 */
export function parseDecl(ctx: Context, source: string): DeclarationList {
	let cap: RegExpExecArray | null;
	const result: DeclarationList = Object.assign([], { stripped: "" });
	// eslint-disable-next-line no-cond-assign
	while ((cap = BRACKET_REGEXP.exec(source))) {
		let rawName = cap[0].slice(1, -1);
		let variadic = false;
		if (rawName.startsWith("...")) {
			rawName = rawName.slice(3);
			variadic = true;
		}
		const [name, rawType] = rawName.split(":");
		const type = rawType ? (rawType.trim() as Argv.DomainType) : undefined;
		result.push({
			variadic,
			required: cap[0][0] === "<",
			...(name !== undefined ? { name } : {}),
			...(type !== undefined ? { type } : {}),
		});
	}
	result.stripped = source
		.replace(/:[\w-]+(?=[>\]])/g, (str) => {
			const domain = ctx.get(`domain:${str.slice(1)}`);
			return domain?.greedy ? "..." : "";
		})
		.trimEnd();
	return result;
}
