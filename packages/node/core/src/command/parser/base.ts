/**
 * CommandBase：命令的声明解析与选项注册基类。
 *
 * Command / CommandCore 均继承本类。职责包括：
 * - 构造时解析命令定义字符串（declaration），得到参数声明列表 `_arguments`
 *   与用于展示的 `declaration`（剥离类型标注后的形式）；
 * - `_createOption` 解析选项定义（如 "-b, --beta <val:number>"），
 *   按前导连字符区分别名（named）与符号别名（symbolic）并注册到查找表；
 * - `parse` 委托给 parse.ts 的 parseCommand 完成实际解析；
 * - `stringify` 把 args / options 还原为命令行文本（日志用）。
 */

import { h } from "@satorijs/core";
import type { Disposable } from "cordis";
import { paramCase } from "cosmokit";
import type { Context } from "../../context";
import type { Argv } from "./argv";
import { parseCommand } from "./parse";

export namespace CommandBase {
	export interface Config {
		/** 严格选项模式：未注册的 `-x` / `--xx` token 一律按普通参数处理 */
		strictOptions?: boolean;
	}
}

// 为兼容旧版 Safari，此处不使用后行断言（lookbehind）
// SYNTAX 匹配一个选项写法：带前导连字符的单词（短选项可连写），或一个非字母数字的符号
const SYNTAX = /(?:-[\w\x80-\uffff-]*|[^,\s\w\x80-\uffff]+)/.source;
// BRACKET 匹配定义中紧随其后的参数声明（<...> 或 [...]，可连续多个）
const BRACKET = /((?:\s*\[[^\]]+?\]|\s*<[^>]+?>)*)/.source;
// 完整的选项定义语法：前段为写法列表（逗号分隔），中段为值声明，尾段为描述文本
const OPTION_REGEXP = new RegExp(
	`^(${SYNTAX}(?:,\\s*${SYNTAX})*(?=\\s|$))?${BRACKET}(.*)$`,
);

export class CommandBase<T extends CommandBase.Config = CommandBase.Config> {
	/** 剥离类型标注后的定义部分（如 "<foo> [bar]"），用于 help 展示 */
	public declaration: string;
	/** 命令名（点分路径形式，如 "a.b"） */
	public readonly name: string;
	public ctx: Context;
	public config: T;

	/** 参数声明列表（由定义字符串解析而来） */
	public _arguments: Argv.Declaration[];
	/** 选项名到声明的映射（键为 camelCase 选项名） */
	public _options: Argv.OptionDeclarationMap = {};
	/** 生命周期清理函数（i18n 定义、选项注册等产生的销毁回调） */
	public _disposables: Disposable[] = [];

	// 由 parse.ts 的算法实现跨模块访问，以下划线命名约定视为内部字段
	/** 按名称注册的选项查找表（含长名与短名，不含前导连字符） */
	_namedOptions: Argv.OptionDeclarationMap = {};
	/** 按符号注册的选项查找表（如 "#"、"@"，经 h.escape 转义） */
	_symbolicOptions: Argv.OptionDeclarationMap = {};

	constructor(name: string, declaration: string, ctx: Context, config: T) {
		this.name = name;
		this.ctx = ctx;
		this.config = config;
		if (!name) throw new Error("expect a command name");
		const declList = (this._arguments = ctx.$commander.parseDecl(declaration));
		this.declaration = declList.stripped;
		// 为每个具名参数声明一条 i18n 文案（默认显示参数名本身）
		for (const decl of declList) {
			if (!decl.name) continue;
			this._disposables.push(
				this.ctx.i18n.define(
					"",
					`commands.${this.name}.arguments.${decl.name}`,
					decl.name,
				),
			);
		}
	}

	/**
	 * 解析并注册一个选项。
	 *
	 * 定义串形如 "-b, --beta <val:number> 描述文本"：
	 * - 逗号分隔的多个写法中，带前导连字符的进 aliases，符号进 symbols；
	 * - 未显式给值声明（bracket 为空）的选项默认为 boolean；
	 * - 给了 value 的选项按取值变体（variant）登记，用于同一选项多种写法取不同值；
	 * - fallback 为 string / number 且未标类型时，用 fallback 的类型补全 type。
	 */
	_createOption(name: string, def: string, config: Argv.OptionConfig) {
		const cap = OPTION_REGEXP.exec(def);
		if (!cap) return;
		const param = paramCase(name);
		let syntax = cap[1] || "--" + param;
		const bracket = cap[2] || "";
		const desc = (cap[3] ?? "").trim();

		const aliases: string[] = config.aliases ?? [];
		const symbols: string[] = config.symbols ?? [];
		for (let param of syntax.trim().split(",")) {
			param = param.trimStart();
			const name = param.replace(/^-+/, "");
			// 不带前导连字符的写法视为符号选项（如 "#")
			if (!name || !param.startsWith("-")) {
				symbols.push(h.escape(param));
			} else {
				aliases.push(name);
			}
		}

		// 未指定固定取值且长名写法未出现时，补全 "-x, --xxx" 形式的完整语法
		if (!("value" in config) && !aliases.includes(param)) {
			syntax += ", --" + param;
		}

		const declList = this.ctx.$commander.parseDecl(bracket.trimStart());
		if (declList.stripped) syntax += " " + declList.stripped;
		// 同名选项重复注册时合并（保留先前登记的别名与变体）
		const option = (this._options[name] ||= {
			...declList[0],
			...config,
			name,
			values: {},
			valuesSyntax: {},
			variants: {},
			syntax,
		});

		let path = `commands.${this.name}.options.${name}`;
		const fallbackType = typeof option.fallback;
		if ("value" in config) {
			// 固定取值选项：登记变体并把所有别名映射到该取值
			path += "." + config.value;
			option.variants[config.value] = { ...config, syntax };
			option.valuesSyntax[config.value] = syntax;
			aliases.forEach((name) => (option.values[name] = config.value));
		} else if (!bracket.trim()) {
			option.type = "boolean";
		} else if (
			!option.type &&
			(fallbackType === "string" || fallbackType === "number")
		) {
			option.type = fallbackType;
		}

		this._disposables.push(this.ctx.i18n.define("", path, desc));
		this._assignOption(option, aliases, this._namedOptions);
		this._assignOption(option, symbols, this._symbolicOptions);
		// 保证 camelCase 主名始终能查到该选项（即使别名里没有它）
		if (!this._namedOptions[param]) {
			this._namedOptions[param] = option;
		}
	}

	/** 把选项按一组名字登记进查找表；重名直接抛错（防止两个选项抢占同一写法） */
	private _assignOption(
		option: Argv.OptionDeclaration,
		names: readonly string[],
		optionMap: Argv.OptionDeclarationMap,
	) {
		for (const name of names) {
			if (name in optionMap) {
				throw new Error(
					`duplicate option name "${name}" for command "${this.name}"`,
				);
			}
			optionMap[name] = option;
		}
	}

	/** 注销一个选项：从 _options 及两张查找表中移除；不存在则返回 false */
	removeOption<K extends string>(name: K) {
		if (!this._options[name]) return false;
		const option = this._options[name];
		delete this._options[name];
		for (const key in this._namedOptions) {
			if (this._namedOptions[key] === option) {
				delete this._namedOptions[key];
			}
		}
		for (const key in this._symbolicOptions) {
			if (this._symbolicOptions[key] === option) {
				delete this._symbolicOptions[key];
			}
		}
		return true;
	}

	/** 解析入口：字符串先走 tokenize，再交给 parseCommand 处理 token 流 */
	parse(argv: string | Argv, terminator?: string): Argv {
		return parseCommand(this, argv, terminator);
	}

	/** 单个参数值的序列化：含空格时补双引号 */
	private stringifyArg(value: any) {
		value = "" + value;
		return value.includes(" ") ? `"${value}"` : value;
	}

	/** 把 args / options 还原为 "cmd --key value arg" 形式的命令行文本 */
	stringify(args: readonly string[], options: any) {
		let output = this.name;
		for (const key in options) {
			const value = options[key];
			if (value === true) {
				output += ` --${key}`;
			} else if (value === false) {
				output += ` --no-${key}`;
			} else {
				output += ` --${key} ${this.stringifyArg(value)}`;
			}
		}
		for (const arg of args) {
			output += " " + this.stringifyArg(arg);
		}
		return output;
	}
}
