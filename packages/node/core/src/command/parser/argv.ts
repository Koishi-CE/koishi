/**
 * 命令参数（argv）模型：命令解析管线的核心数据结构定义与运行时门面。
 *
 * 本模块包含三部分：
 * - `Token`：tokenizer 产出的最小词法单元（携带引号与插值信息）；
 * - `Argv`：贯穿「解析 → 校验 → 执行」全流程的参数上下文；
 * - `Argv` namespace / 同名 const：类型层（内置 domain、声明、选项配置、
 *   从命令定义字符串推导参数/选项类型的模板类型）与运行时层
 *   （parse / stringify / revert 等静态方法，内部委托给 Tokenizer）。
 */

import type { h } from "@satorijs/core";
import type { Dict } from "cosmokit";
import type { Channel, User } from "../../database/index.ts";
import type { Next } from "../../middleware/index.ts";
import type { Permissions } from "../../permission.ts";
import type { Session } from "../../session/index.ts";
import type { Command } from "../command/command.ts";
import { bracs, interpolate, Tokenizer, whitespace } from "./tokenizer.ts";

/** tokenizer 产出的最小词法单元 */
export interface Token {
	/** 解析过程中尚未消费的剩余原文；parse 结束后会被删除，不进入最终 argv */
	rest?: string;
	/** token 的文本内容（已还原被转义的空白字符） */
	content: string;
	/** 是否被引号包裹（被包裹的 token 不会被当作选项或数字解析） */
	quoted: boolean;
	/** 终结符：本 token 结束处匹配到的字符（空白、右引号或终止符） */
	terminator: string;
	/** token 内部出现的插值段（如 `$(...)`），按出现顺序记录 */
	inters: Argv[];
}

/**
 * 一次命令调用的完整上下文：从消息解析、命令匹配到 action 执行所共享的状态。
 *
 * 泛型参数用于在类型层面约束 action 回调能访问到的数据：
 * U/G 为可观测的 user / channel 字段，A / O 为参数与选项的推导类型。
 */
export interface Argv<
	U extends User.Field = never,
	G extends Channel.Field = never,
	A extends unknown[] = unknown[],
	O extends object = object,
> {
	/** 位置参数（已按声明中的 domain 类型强转） */
	args?: A;
	/** 选项键值对（键为 camelCase 形式的选项名） */
	options?: O;
	/** 解析或执行阶段产生的用户可读错误信息；非空时命令不会执行 */
	error?: string;
	/** 本次调用的原始输入还原文本（用于日志与错误提示） */
	source?: string;
	/** 插值起始符（如 "$("）；存在说明本 argv 来自某个插值段 */
	initiator?: string;
	/** 插值终结符 */
	terminator?: string;
	/** 触发本次调用的会话 */
	session?: Session<U, G>;
	/** 解析出的目标命令；inferCommand 阶段填充 */
	command?: Command<U, G, A, O>;
	/** 终止符之后的剩余文本（terminator 参数所截断的后半段） */
	rest?: string;
	/** 本 argv 在父 token content 中的字符偏移；revert 还原插值时使用 */
	pos?: number;
	/** 是否由消息根（而非插值或子执行）直接发起 */
	root?: boolean;
	/** tokenizer 产出的词法单元序列；解析完成后被删除 */
	tokens?: Token[];
	/** 已解析出的命令路径名（点分形式，如 "a.b"） */
	name?: string;
	/** next 函数：action 之间的洋葱模型传递（见 Command.execute） */
	next?: Next;
}

// erasableSyntaxOnly 不允许含运行时值的 namespace:
// 类型保留在纯类型 namespace 中,运行时值由下方同名 const 对象承载
export namespace Argv {
	/** 插值语法定义：起始符与终结符之间的内容如何被解析 */
	export interface Interpolation {
		/** 终结符（如 "$(" 对应 ")"） */
		terminator?: string;
		/** 自定义解析器；不提供则默认按 Argv.parse 递归解析 */
		parse?(source: string): Argv;
	}

	// 内置 domain（参数类型）表：声明中 `<foo:number>`、`[bar:text]` 等类型标注的取值
	export interface Domain {
		/** 元素序列（h 数组），贪婪匹配到结尾 */
		el: h[];
		/** 同 el，贪婪匹配 */
		elements: h[];
		/** 普通字符串（还原转义） */
		string: string;
		/** 数字 */
		number: number;
		/** 布尔值（通常用于选项） */
		boolean: boolean;
		/** 贪婪文本：吞掉剩余全部输入（含选项样式的 token） */
		text: string;
		/** 贪婪原始文本：保留元素序列化形式，不做反转义 */
		rawtext: string;
		/** 用户标识（platform:userId 形式） */
		user: string;
		/** 频道标识（platform:channelId 形式） */
		channel: string;
		/** 整数 */
		integer: number;
		/** 正整数（> 0） */
		posint: number;
		/** 自然数（>= 0） */
		natural: number;
		/** 大整数 */
		bigint: bigint;
		/** 日期（解析为 Date 对象） */
		date: Date;
		/** 图片元素的属性对象 */
		img: JSX.IntrinsicElements["img"];
		/** 同 img */
		image: JSX.IntrinsicElements["img"];
		/** 语音元素的属性对象 */
		audio: JSX.IntrinsicElements["audio"];
		/** 视频元素的属性对象 */
		video: JSX.IntrinsicElements["video"];
		/** 文件元素的属性对象 */
		file: JSX.IntrinsicElements["file"];
	}

	/** 内置 domain 名集合 */
	export type DomainType = keyof Domain;

	/** 提取声明段 `foo:bar` 中冒号后的 domain 名并映射到对应类型；未标注则回退 F */
	type ParamType<S extends string, F> = S extends `${string}:${infer T}`
		? T extends DomainType
			? Domain[T]
			: F
		: F;

	/** 递归地把字符串类型 S 中的 X 全部替换为 Y（用于把 `>` 统一换成 `]` 以便按 `]` 切分） */
	type Replace<
		S extends string,
		X extends string,
		Y extends string,
	> = S extends `${infer L}${X}${infer R}` ? `${L}${Y}${Replace<R, X, Y>}` : S;

	/** 提取声明中全部 `...]` 段的类型（对应每个具名参数） */
	type ExtractAll<S extends string, F> = S extends `${infer L}]${infer R}`
		? [ParamType<L, F>, ...ExtractAll<R, F>]
		: [];

	/** 只提取声明中第一个 `...]` 段的类型（选项只取一个值） */
	type ExtractFirst<S extends string, F> = S extends `${infer L}]${string}`
		? ParamType<L, F>
		: boolean;

	/** 处理变长参数 `...`：其后的类型展开为不定长数组，前缀保持定长元组 */
	type ExtractSpread<S extends string> = S extends `${infer L}...${infer R}`
		? [...ExtractAll<L, string>, ...ExtractFirst<R, string>[]]
		: [...ExtractAll<S, string>, ...string[]];

	/** 从命令定义的参数部分（如 `<a:number> [...b:string]`）推导 args 的元组类型 */
	export type ArgumentType<S extends string> = ExtractSpread<
		Replace<S, ">", "]">
	>;

	/** 从选项定义（如 `<val:number>`）推导选项值类型；无值声明的选项推导为 boolean，
	 * 带值声明但未标注类型时推导为 string（与运行时 parseValue 的默认 string 域一致） */
	export type OptionType<S extends string> = ExtractFirst<
		Replace<S, ">", "]">,
		string
	>;

	/**
	 * 参数类型的完整描述：既可以是内置 domain 名，
	 * 也可以直接给 RegExp（正则校验）、字符串数组（枚举）、
	 * 转换函数或 DomainConfig 对象。
	 */
	export type Type =
		| DomainType
		| RegExp
		| readonly string[]
		| Transform<unknown>
		| DomainConfig<unknown>;

	/** 参数 / 选项的单条声明 */
	export interface Declaration {
		/** 声明名（省略时回退到命令名） */
		name?: string;
		/** 类型标注 */
		type?: Type;
		/** 默认值（parse 结束时填充到 options，未出现在结果中的参数不填） */
		fallback?: unknown;
		/** 是否为变长参数（`...foo`），吃掉剩余全部 token */
		variadic?: boolean;
		/** 是否必填（`<foo>` 为必填，`[foo]` 为可选） */
		required?: boolean;
	}

	/** 类型转换函数：把原始字符串转换为实际取值；抛出异常即视为校验失败 */
	export type Transform<T> = (source: string, session: Session) => T;

	/** domain 的注册配置 */
	export interface DomainConfig<T = unknown> {
		/** 转换函数本体 */
		transform?: Transform<T>;
		/** 贪婪类型（如 text / el）：匹配时吞掉剩余全部输入 */
		greedy?: boolean;
		/** 数值类型：允许把 "-1" 这样的 token 当作参数值而非选项 */
		numeric?: boolean;
	}

	/** 选项固定取值的类型（value 变体，如 "-A, --anonymous" 预设值） */
	export type OptionValue = string | number | boolean | null;

	/** 选项注册配置 */
	export interface OptionConfig<T extends Type = Type>
		extends Permissions.Config {
		/** 别名列表（不含前导连字符） */
		aliases?: string[];
		/** 符号别名列表（如 "#"、"@"，不解析为普通选项名） */
		symbols?: string[];
		/** 固定取值：出现该选项即取此值（用于 -A, --anonymous 类开关） */
		value?: OptionValue;
		/** 默认值：未显式传入时填充 */
		fallback?: unknown;
		/** 值类型标注 */
		type?: T;
		/** i18n 描述的路径覆盖（默认 commands.<cmd>.options.<name>） */
		descPath?: string;
	}

	/** 强制携带 type 的选项配置（重载签名用，保证推导出的值类型准确） */
	export interface TypedOptionConfig<T extends Type> extends OptionConfig<T> {
		type: T;
	}

	/** 选项的一个语法变体（同一选项的不同写法） */
	export interface OptionVariant extends OptionConfig {
		/** 本变体对应的语法串（如 "-W, --anonymous"） */
		syntax: string;
	}

	/** 选项的完整声明：合并 Declaration 与变体信息 */
	export interface OptionDeclaration extends Declaration, OptionVariant {
		/** 别名到固定取值的映射（value 选项） */
		values: Dict<OptionValue>;
		/** @deprecated 已废弃，保留兼容 */
		valuesSyntax: Dict<string>;
		/** 取值到语法变体的映射 */
		variants: Dict<OptionVariant>;
	}

	/** 选项名到声明的映射表 */
	export type OptionDeclarationMap = Dict<OptionDeclaration>;
}

// 与上方 interface Argv / namespace Argv 合并声明
export const Argv = {
	interpolate,
	whitespace,
	Tokenizer,

	/** 用默认 tokenizer 把消息原文解析为 Argv（词法分析入口） */
	parse(source: string, terminator = "") {
		return defaultTokenizer.parse(source, terminator);
	},

	/** 把 tokens / rest 还原回字符串（供贪婪参数取值与日志输出） */
	stringify(argv: Argv) {
		return defaultTokenizer.stringify(argv);
	},

	/**
	 * 还原 token 中的插值段：把 inters 里记录的子 argv 按 pos 塞回 content，
	 * 重建 "$(...)": 源码 " + 终结符的原文形式。
	 * 单引号 token 不做插值求值，靠此方法恢复原文。
	 */
	revert(token: Token) {
		while (token.inters.length) {
			const inter = token.inters.pop();
			if (!inter) break;
			const { pos, source, initiator } = inter;
			token.content =
				token.content.slice(0, pos) +
				(initiator ?? "") +
				(source ?? "") +
				(bracs[initiator ?? ""]?.terminator ?? "") +
				token.content.slice(pos);
		}
	},
};

const defaultTokenizer = new Tokenizer();
