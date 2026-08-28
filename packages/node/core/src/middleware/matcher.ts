/**
 * 快捷对话（ctx.match）的匹配执行逻辑。
 *
 * 快捷对话是"输入某句话自动回复"的轻量机制，无需定义指令。
 * 在 attach 阶段（before-attach 事件）对每条消息尝试全部已注册匹配器，
 * 命中则把回复挂到 session.response 上，短路后续中间件。
 */
import { type Fragment, h } from "@satorijs/core";
import type { Awaitable } from "cosmokit";
import type { Context } from "../context";
import type { Session } from "../session";

/** 一条快捷对话：模式 + 回复 + 选项 + 所属上下文。 */
export interface Matcher extends Matcher.Options {
	/** 注册时的上下文（其 filter 决定本匹配器的准入范围） */
	context: Context;
	/** 匹配模式：字符串（模板文本）或正则 */
	pattern: string | RegExp;
	/** 回复内容：静态片段或以 (session, 捕获组) 计算的函数 */
	response: Matcher.Response;
}

export namespace Matcher {
	/** 回复：Fragment 或按会话与捕获参数动态生成的函数 */
	export type Response =
		| Fragment
		| ((
				session: Session,
				params: [string, ...string[]],
		  ) => Awaitable<Fragment>);

	export interface Options {
		/** pattern 是 i18n 路径：按用户语言取对应文案再匹配 */
		i18n?: boolean;
		/** 要求消息必须带称呼（@机器人 或昵称开头）才可命中 */
		appel?: boolean;
		/** 允许模式后跟任意附加内容（否则要求整条消息完全一致） */
		fuzzy?: boolean;
		/** i18n 文案按正则语义解释 */
		regex?: boolean;
	}
}

/**
 * 对单条会话执行一个匹配器。
 *
 * 匹配对象是"正文 + 引用消息内容"（引用内容以空格拼接，使
 * "回复某消息触发快捷对话"成为可能）；字符串模式默认要求全文相等，
 * fuzzy 模式只要求前缀匹配且剩余部分以空白开头（除非带称呼）；
 * i18n 模式则逐语言取文案模板（可按 regex 编译为正则）再匹配，
 * 命中后把会话语言锁定为该语言。命中即写入 session.response，
 * response 内的捕获组还会被解析为消息元素（支持元素插值）。
 */
export function executeMatcher(
	ctx: Context,
	session: Session,
	matcher: Matcher,
) {
	const { stripped, quote } = session;
	const { appel, context, i18n, regex, fuzzy, pattern, response } = matcher;
	// 配置要求称呼、或消息 @ 了别人时，没有称呼（@机器人/昵称）则跳过
	if ((appel || stripped.hasAt) && !stripped.appel) return;
	if (!context.filter(session)) return;
	let content = stripped.content;
	if (quote?.content) content += " " + quote.content;

	const match = (pattern: any): [string, ...string[]] | null => {
		if (!pattern) return null;
		if (typeof pattern === "string") {
			// 非模糊模式要求整条消息与模板一致
			if ((!fuzzy && content !== pattern) || !content.startsWith(pattern))
				return null;
			const rest = content.slice(pattern.length);
			// 模糊模式下，模板与后续内容之间必须有词边界
			//（带称呼时正文本身就是模板，允许紧接任意内容）
			if (fuzzy && !stripped.appel && rest.match(/^\S/)) {
				return null;
			}
			return [content, rest];
		} else {
			return pattern.exec(content);
		}
	};

	let params: [string, ...string[]] | null = null;
	if (!i18n) {
		params = match(pattern);
	} else {
		// i18n 模式：逐语言取出模板文本再匹配，命中即锁定会话语言
		for (const locale of ctx.i18n.fallback([])) {
			const store = ctx.i18n._data[locale];
			let value = store?.[pattern as string] as string | RegExp;
			if (!value) continue;
			if (regex) {
				// 正则模式：无称呼时要求模板后接空白，模糊模式再允许捕获剩余内容
				const rest = fuzzy
					? `(?:${stripped.appel ? "" : "\\s+"}([\\s\\S]*))?`
					: "";
				value = new RegExp(`^(?:${value})${rest}$`);
			}
			params = match(value);
			if (!params) continue;
			session.locales = [locale];
			break;
		}
	}

	if (!params) return;
	const captured = params;
	// 惰性构造回复：正文调用时才 resolve，捕获组同步解析为元素
	session.response = async () => {
		const output = await session.resolve(response, captured);
		return h.normalize(
			output,
			captured.map((source) => (source ? h.parse(source) : "")),
		);
	};
}
