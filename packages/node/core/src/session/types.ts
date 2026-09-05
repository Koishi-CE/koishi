// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 会话模块的公共类型定义。
 *
 * 包含 Session 接口（对 satori Session 的扩展，是全部能力层的
 * 类型契约）、消息预处理结果（Stripped）、一次性提问与纠错建议的
 * 选项，以及"字段收集器"机制（FieldCollector / collectFields），
 * 后者让指令声明所需数据表字段、框架在执行前一次性批量预取。
 */
import type * as satori from "@satorijs/core";
import type {
	Fragment,
	h,
	Universal,
} from "@satorijs/core";
import type { Awaitable } from "cosmokit";
import type { Eval } from "minato";
import type { Argv } from "../command/index.ts";
import type { Context } from "../context/index.ts";
import type {
	Channel,
	Tables,
	User,
} from "../database/index.ts";
import type { CompareOptions } from "../i18n/index.ts";
import type {
	Middleware,
	Next,
} from "../middleware/index.ts";

/** 一次性提问（session.prompt）的选项。 */
export interface PromptOptions {
	/** 等待用户回复的最长毫秒数，超时返回 undefined */
	timeout?: number;
}

/** 输入纠错建议（session.suggest）的选项。 */
export interface SuggestOptions extends CompareOptions {
	/** 用户实际输入的内容（用于与 expect 做模糊匹配） */
	actual?: string;
	/** 期望的候选词列表 */
	expect: readonly string[];
	/** 候选词的附加过滤条件（异步） */
	filter?: (name: string) => Awaitable<boolean>;
	/** 提示文案的前缀（通常是"你是不是想输入："之类的引导语） */
	prefix?: string;
	/** 唯一候选被确认（用户输入 . ）后追加的正文 */
	suffix: string;
	/** 等待确认的超时毫秒数 */
	timeout?: number;
}

/**
 * 消息预处理结果：从原始消息中剥离 @机器人、昵称称呼等前缀后的结构。
 * 指令解析（matcher）以 content 为输入，而非原始消息文本。
 */
export interface Stripped {
	/** 剥离前缀后的正文 */
	content: string;
	/** 命令前缀（由 matcher 阶段填充，此处恒为 null） */
	prefix: string | null;
	/** 是否带有"称呼"（@机器人 或昵称开头）——决定是否允许无前缀触发指令 */
	appel: boolean;
	/** 消息中是否 @ 了别人（不含被引用消息里的 @） */
	hasAt: boolean;
	/** 是否 @ 了机器人自身 */
	atSelf: boolean;
}

/**
 * 字段收集器：声明某操作需要预取的数据表字段。
 *
 * 可以是字段名列表（如 `["authority", "name"]`），
 * 也可以是函数（能根据 argv 动态决定要收集哪些字段）。
 * 指令通过它声明所需字段，框架在执行前一次性批量查出，避免逐字段查询。
 */
export type FieldCollector<
	T extends keyof Tables,
	K = keyof Tables[T],
	A extends unknown[] = unknown[],
	O extends object = object,
> =
	| Iterable<K>
	| ((
			argv: Argv<never, never, A, O>,
			fields: Set<keyof Tables[T]>,
	  ) => void);

/** 汇总多个收集器的结果到同一个字段集合。 */
export function collectFields<T extends keyof Tables>(
	argv: Argv,
	collectors: FieldCollector<T>[],
	fields: Set<keyof Tables[T]>,
) {
	for (const collector of collectors) {
		if (typeof collector === "function") {
			collector(argv, fields);
			continue;
		}
		for (const field of collector) {
			fields.add(field);
		}
	}
	return fields;
}

/**
 * Koishi 会话的公开接口（对 satori Session 的扩展）。
 *
 * 泛型参数 U / G 是"本会话已预取的用户 / 频道字段"（类型层面的字段追踪），
 * observeUser / observeChannel 会收窄这些泛型，使后续访问字段时能获得类型保障。
 * 实现分散在 session/ 目录的各能力层类中。
 */
export interface Session<
	U extends User.Field = never,
	G extends Channel.Field = never,
	C extends Context = Context,
> extends satori.Session<C> {
	/** 当前指令解析结果（会话由指令系统触发时存在） */
	argv?: Argv<U, G>;
	/** 当前用户的可观察数据（未调用 observeUser 前不存在） */
	user?: User.Observed<U>;
	/** 当前频道的可观察数据 */
	channel?: Channel.Observed<G>;
	/** 当前群（guild）频道的可观察数据；私聊时与 channel 相同 */
	guild?: Channel.Observed<G>;
	/** 本会话已确认的权限列表（会话临时授权，如通过指令授予） */
	permissions: string[];
	/** i18n 作用域（withScope 设置），用于解析相对路径 */
	scope?: string;
	/** 事件回复回调（部分平台事件支持直接应答；快捷对话命中时也会设置） */
	response?: () => Promise<Fragment>;
	/**
	 * 求值计算属性：静态值原样返回；函数以 (session, ...args) 调用；
	 * minato Eval 表达式则在本会话上下文（`_`）中执行。
	 */
	resolve<T, R extends unknown[]>(
		source:
			| T
			| Eval.Expr
			| ((session: Session, ...args: R) => T),
		...args: R
	): T extends Eval.Expr
		? Eval<T>
		: T extends (...args: never[]) => unknown
			? ReturnType<T>
			: T;
	/** 消息预处理结果（惰性缓存） */
	stripped: Stripped;
	/** 发送者显示名：优先用户库昵称，其次消息作者昵称/用户名，最后 userId */
	username: string;
	/** 向当前频道发送消息，返回消息 ID 列表；发送失败记录警告并返回空数组 */
	send(
		fragment: Fragment,
		options?: Universal.SendOptions,
	): Promise<string[]>;
	/** 清空排队队列，并在 delay 毫秒后恢复发送 */
	cancelQueued(delay?: number): void;
	/**
	 * 排队发送消息：按配置的 message / character 延迟节流，
	 * 多条消息会依次发出（防风控刷屏），返回最后一条的消息 ID。
	 */
	sendQueued(
		content: Fragment,
		delay?: number,
	): Promise<string[] | undefined>;
	/** 查询频道记录；不存在时按 autoAssign 配置决定是否入库创建 */
	getChannel<K extends Channel.Field = never>(
		id?: string,
		fields?: K[],
	): Promise<Channel>;
	/**
	 * 观察频道数据：批量取出 fields 字段并包装为可观察对象，
	 * 后续对其的修改会在事件循环收尾时自动写回数据库。
	 */
	observeChannel<T extends Channel.Field = never>(
		fields: Iterable<T>,
	): Promise<Channel.Observed<T | G>>;
	/** 查询用户记录；不存在时按 autoAuthorize 配置决定初始等级并创建 */
	getUser<K extends User.Field = never>(
		userId?: string,
		fields?: K[],
	): Promise<User>;
	/**
	 * 观察用户数据（语义同 observeChannel）。
	 * 匿名用户不会入库，改用内存中的临时观察对象。
	 */
	observeUser<T extends User.Field = never>(
		fields: Iterable<T>,
	): Promise<User.Observed<T | U>>;
	/**
	 * 在指定 i18n 作用域内执行回调：回调内 i18n 元素的相对路径
	 * 会被解析为 scope + path，结束后恢复原作用域。
	 */
	withScope(
		scope: string,
		callback: () => Awaitable<h[]>,
	): Promise<h[]>;
	/** 解析 i18n 路径：以 `.` 开头的相对路径拼接当前 scope */
	resolveScope(path: string): string;
	/** 以纯文本渲染 i18n 文案（各语言片段拼接为字符串） */
	text(path: string | string[], params?: object): string;
	/** 以元素数组渲染 i18n 文案（保留 i18n 元素，供后续 transform） */
	i18n(path: string | string[], params?: object): h[];
	/**
	 * 收集执行 argv 所需的 user / channel 字段：
	 * 遍历 argv 中的嵌套插值指令，触发 command/before-attach-* 事件
	 * 让插件补充字段，再合并指令声明的字段列表。
	 */
	collect<T extends "user" | "channel">(
		key: T,
		argv: Argv | undefined,
		fields?: Set<keyof Tables[T]>,
	): Set<keyof Tables[T]>;
	/**
	 * 执行一条指令：解析插值、预取用户/频道数据、进入指令 i18n 作用域，
	 * 最后把结果发送回当前频道（next 传 true 时只返回不发送）。
	 */
	execute(
		content: string | Argv,
		next?: true | Next,
	): Promise<h[]>;
	/** 注册仅对当前会话生效的临时中间件，返回注销函数 */
	middleware(middleware: Middleware): () => boolean;
	/** 等待当前用户的下一条消息（剥离 @机器人 前缀），超时返回 undefined */
	prompt(timeout?: number): Promise<string | undefined>;
	/**
	 * prompt 的回调版本：以自定义逻辑处理下一条消息并返回结果。
	 * 超时同样 resolve(undefined)（不抛异常），回调自身也可返回可空值
	 * upstream: koishijs/koishi#1516
	 */
	prompt<T>(
		callback: (session: Session) => Awaitable<T>,
		options?: PromptOptions,
	): Promise<T | undefined>;
	/** 发送纠错建议；当只剩唯一候选时等待用户输入 `.` 确认，返回确认结果 */
	suggest(
		options: SuggestOptions,
	): Promise<string | undefined>;
}
