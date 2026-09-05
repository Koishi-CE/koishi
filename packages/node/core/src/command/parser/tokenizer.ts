// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * tokenizer：把消息原文切分为 token 序列的词法分析器。
 *
 * 处理的语法元素包括：
 * - 引号（含中英文弯引号）：成对包裹的内容成为单个 token 且不被当作选项；
 * - 插值（默认 "$( ... )"）：内部递归解析为子 argv 记录在 token.inters；
 * - 终止符（terminator）：截断解析并把剩余文本留给 rest（供管道等语法使用）；
 * - 非文本元素（如 <img>）：内部空白被转义为占位符，避免被当作分隔符切开。
 *
 * parse 产出 Argv（tokens + rest + source），stringify 则做逆向还原。
 */

import { escapeRegExp } from "@koishi-ce/utils";
import { h } from "@satorijs/core";
import type { Dict } from "cosmokit";
import { Argv, type Token } from "./argv.ts";

/** 左引号字符表（直引号 + 中文弯引号），与 rightQuotes 按下标配对 */
const leftQuotes = `"'“‘`;
/** 右引号字符表，与 leftQuotes 按下标配对 */
const rightQuotes = `"'”’`;

/** 全局插值语法注册表（键为起始符，如 "$("） */
export const bracs: Dict<Argv.Interpolation> = {};

/** 注册一种插值语法：起始符 + 终结符 + 可选的自定义解析器 */
export function interpolate(
	initiator: string,
	terminator: string,
	parse?: (source: string) => Argv,
) {
	bracs[initiator] = {
		terminator,
		...(parse ? { parse } : {}),
	};
}

// 默认插值语法：$(...)
interpolate("$(", ")");

/**
 * 空白占位符转义工具。
 * 非文本元素序列化后可能含空格 / 换行，若不转义会被 tokenizer 当作 token 边界；
 * 故先替换为不含空白的占位符，token 化结束后再还原。
 */
export const whitespace = {
	unescape: (source: string) =>
		source
			.replace(/@__KOISHI_SPACE__@/g, " ")
			.replace(/@__KOISHI_NEWLINE__@/g, "\n")
			.replace(/@__KOISHI_RETURN__@/g, "\r")
			.replace(/@__KOISHI_TAB__@/g, "\t"),

	escape: (source: string) =>
		source
			.replace(/ /g, "@__KOISHI_SPACE__@")
			.replace(/\n/g, "@__KOISHI_NEWLINE__@")
			.replace(/\r/g, "@__KOISHI_RETURN__@")
			.replace(/\t/g, "@__KOISHI_TAB__@"),
};

/** 词法分析器：支持实例级插值语法注册（原型链自全局 bracs） */
export class Tokenizer {
	private bracs: Dict<Argv.Interpolation>;

	constructor() {
		// 以全局表为原型：实例注册的语法仅本实例可见，全局注册的对所有实例生效
		this.bracs = Object.create(bracs);
	}

	/** 在本实例上注册一种插值语法 */
	interpolate(
		initiator: string,
		terminator: string,
		parse?: (source: string) => Argv,
	) {
		this.bracs[initiator] = {
			terminator,
			...(parse ? { parse } : {}),
		};
	}

	/**
	 * 解析单个 token。
	 *
	 * @param source 以本 token 起始的剩余原文
	 * @param stopReg 停止条件（正则源），通常是空白 / 终止符 / 行尾
	 * 遇到引号开头时改为「匹配右引号且后随停止条件」，
	 * 保证 `"a b"` 不在内部空白处断开。
	 * 遇到插值起始符则递归解析子 argv 记入 inters，并从其后继续；
	 * 单引号 token 不求值插值，返回前用 Argv.revert 恢复原文。
	 */
	parseToken(source: string, stopReg = "$"): Token {
		const parent: Token = {
			content: "",
			quoted: false,
			terminator: "",
			inters: [],
		};
		const index = leftQuotes.indexOf(source.charAt(0));
		// 越界时保持 undefined（不可改成 ""）：行尾 "$" 会匹配出空串，
		// 若 quote 为 "" 则 capture[0] === quote 恒真，末尾 token 会被误判为引号包裹
		const quote = rightQuotes[index];
		let content = "";
		if (quote) {
			source = source.slice(1);
			// 只有当右引号后紧跟停止条件（空白 / 终止符 / 行尾）才算闭合
			stopReg = `${quote}(?=${stopReg})|$`;
		}
		// 把全部停止条件（含各插值起始符）拼成一个正则
		stopReg += `|${Object.keys({ ...this.bracs, ...bracs })
			.map(escapeRegExp)
			.join("|")}`;
		const regExp = new RegExp(stopReg);
		while (true) {
			const capture = regExp.exec(source);
			if (!capture) return parent;
			content += whitespace.unescape(
				source.slice(0, capture.index),
			);
			if (capture[0] in this.bracs) {
				// 命中插值起始符：递归解析子 argv，剩余原文以解析结果为准
				source = source
					.slice(capture.index + capture[0].length)
					.trimStart();
				const brac = this.bracs[capture[0]];
				const argv =
					brac?.parse?.(source) ||
					this.parseTokens(source, brac?.terminator, false);
				source = argv.rest ?? "";
				parent.inters.push({
					...argv,
					pos: content.length,
					initiator: capture[0],
				});
			} else {
				// 命中停止条件：本 token 到此结束，记录引用状态与终结符
				const quoted = capture[0] === quote;
				const rest = source.slice(capture.index + +quoted);
				parent.rest = rest.trimStart();
				parent.quoted = quoted;
				parent.terminator = capture[0];
				if (quoted) {
					// 闭合引号时，终结符要连同引号后、下一个 token 前的空白一起记录，
					// 供 stringify 精确还原
					parent.terminator += rest.slice(
						0,
						-parent.rest.length,
					);
				} else if (quote) {
					// 有左引号但未闭合：左引号按普通字符计回 content，插值偏移 +1
					content = (leftQuotes[index] ?? "") + content;
					parent.inters.forEach(
						(inter) => (inter.pos = (inter.pos ?? 0) + 1),
					);
				}
				parent.content = content;
				// 单引号内的插值不求值，恢复为原文
				if (quote === "'") Argv.revert(parent);
				return parent;
			}
		}
	}

		/**
		 * 把原文完整解析为 Argv。
		 *
		 * 先用 h.parse 做元素级预处理：文本元素保持原样，
		 * 其它元素序列化后转义内部空白，防止被当作分隔符。
		 * 随后循环取 token 直到遇到 terminator 开头或耗尽；
		 * 最终从尾部反推出 source（被 tokens + rest 消费掉的部分）。
		 */
		parse(source: string, terminator = ""): Argv {
			source = h
				.parse(source)
				.map((el) => {
					return el.type === "text"
						? el.toString()
						: whitespace.escape(el.toString());
				})
				.join("");
			return this.parseTokens(source, terminator, true);
		}

		/**
		 * 对已预处理的文本做 token 化（parse 的后半段）。
		 *
		 * 插值递归（parseToken 内）必须走本方法：递归拿到的已是外层
		 * 预处理过的文本，再次 h.parse/escape 会破坏已转义的元素、
		 * 再次 unescape 会把外层尚未消费的 rest 提前还原，元素被拆成
		 * 多个垃圾 token
		 * upstream: koishijs/koishi#1541
		 *
		 * @param root 最外层调用：rest/source 在结尾统一还原；
		 *             插值子层仅还原 source（供 revert 复原原文），
		 *             rest 保持转义形态交回外层继续切
		 */
		private parseTokens(
			source: string,
			terminator: string,
			root: boolean,
		): Argv {
			const tokens: Token[] = [];
			let rest = source,
				term = "";
			const stopReg = `\\s+|[${escapeRegExp(terminator)}]|$`;
			// eslint-disable-next-line no-unmodified-loop-condition
			while (
				rest &&
				!(terminator && rest.startsWith(terminator))
			) {
				const token = this.parseToken(rest, stopReg);
				tokens.push(token);
				rest = token.rest ?? "";
				term = token.terminator;
				delete token.rest;
			}
			if (rest.startsWith(terminator)) rest = rest.slice(1);
			// source = 原文去掉尾部未被消费的 rest 与最后一个终结符
			source = source.slice(0, -(rest + term).length);
			if (!root) {
				return {
					tokens,
					rest,
					source: whitespace.unescape(source),
				};
			}
			rest = whitespace.unescape(rest);
			source = whitespace.unescape(source);
			return { tokens, rest, source };
		}

	/**
	 * 把 argv 的 tokens / rest 还原为字符串。
	 * 若尾部字符不是右引号（说明原文以引号截断），或本 argv 是插值段，
	 * 则去掉最后一个字符（对应的终结符），以恢复原始输入。
	 */
	stringify(argv: Argv) {
		const output = (argv.tokens ?? []).reduce(
			(prev, token) => {
				if (token.quoted)
					prev +=
						leftQuotes[
							rightQuotes.indexOf(token.terminator[0] ?? "")
						] || "";
				return prev + token.content + token.terminator;
			},
			"",
		);
		if (
			(argv.rest &&
				!rightQuotes.includes(
					output[output.length - 1] ?? "",
				)) ||
			argv.initiator
		) {
			return output.slice(0, -1);
		}
		return output;
	}
}
