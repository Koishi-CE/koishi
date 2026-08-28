/**
 * 中间件处理器（ctx.$processor）——消息事件的处理中枢。
 *
 * 每条消息事件进入 `_handleMessage` 后被组织为一个中间件洋葱队列：
 * 内置的 attachSession（装配数据）永远排在最前（prepend），
 * 之后是插件注册的各中间件与指令解析（ctx.middleware / ctx.match）。
 *
 * 同目录分工：next.ts（Next 调度与 SessionError）、matcher.ts（快捷对话匹配）、
 * attach.ts（频道/用户数据装配）、components.ts（内置消息组件）、
 * shared-cache.ts（共享缓存事件）。
 */
import { coerce } from "@koishi-ce/utils";
import type { EventOptions, Hook } from "@satorijs/core";
import { type Awaitable, type Dict, defineProperty } from "cosmokit";
import { Context } from "../context";
import type { Channel, User } from "../database";
import type { Session } from "../session";
import { attachSession } from "./attach";
import { registerComponents } from "./components";
import { executeMatcher, type Matcher } from "./matcher";
import type { Middleware } from "./next";
import { Next, SessionError } from "./next";

export * from "./matcher";
export * from "./next";
export * from "./shared-cache";

declare module "../context" {
	interface Context {
		/** 消息处理器服务：管理中间件与快捷对话 */
		$processor: Processor;
		/**
		 * 注册消息中间件，返回注销函数。
		 *
		 * @param prepend 为 true 时插到队列头部（先于已有中间件执行）
		 */
		middleware<S extends Session = Session>(
			middleware: Middleware<S>,
			prepend?: boolean,
		): () => boolean;
		/** 注册快捷对话（正则/字符串匹配自动回复，见 matcher.ts） */
		match(
			pattern: string | RegExp,
			response: Matcher.Response,
			options?: Matcher.Options & { i18n?: false },
		): () => boolean;
		/** match 的 i18n 版：response 是文案路径，按用户语言渲染 */
		match(
			pattern: string,
			response: string,
			options: Matcher.Options & { i18n: true },
		): () => boolean;
	}

	interface Events {
		/** 频道数据装配前：监听者可向 fields 补充需要预取的字段 */
		"before-attach-channel"(session: Session, fields: Set<Channel.Field>): void;
		/** 频道数据装配后；返回 true 可短路整个处理流程 */
		// biome-ignore lint/suspicious/noConfusingVoidType: 事件负载：void 表示监听器无输出、true 表示短路，改为 undefined 会破坏 void 返回监听器的可赋值性
		"attach-channel"(session: Session): Awaitable<void | boolean>;
		/** 用户数据装配前：同上，可补充预取字段 */
		"before-attach-user"(session: Session, fields: Set<User.Field>): void;
		/** 用户数据装配后；返回 true 可短路 */
		// biome-ignore lint/suspicious/noConfusingVoidType: 事件负载：void 表示监听器无输出、true 表示短路，改为 undefined 会破坏 void 返回监听器的可赋值性
		"attach-user"(session: Session): Awaitable<void | boolean>;
		/** 数据装配全部开始前 */
		"before-attach"(session: Session): void;
		/** 数据装配全部完成（含频道/用户） */
		attach(session: Session): void;
		/** 消息处理完毕（含数据写回）后 */
		middleware(session: Session): void;
	}
}

/** 消息处理器：中间件队列、快捷对话集合与会话登记表。 */
export class Processor {
	/** 中间件队列（按注册顺序 / prepend 规则排列） */
	_hooks: Hook[] = [];
	/** 进行中的会话登记表（session.id -> Session），用于 next 孤立检测 */
	_sessions: Dict<Session> = Object.create(null);
	/** 已注册的快捷对话（match）集合 */
	_matchers = new Set<Matcher>();

	private ctx: Context;

	constructor(ctx: Context) {
		this.ctx = ctx;
		// 标记当前活跃上下文，供 cordis 依赖注入系统识别服务归属
		defineProperty(this, Context.current, ctx);

		// 绑定内置事件监听
		this.middleware(
			(session, next) => attachSession(this.ctx, session, next),
			true,
		);
		ctx.on("message", this._handleMessage.bind(this));

		// 把 collect 收集字段挂到 attach 事件链上：
		// 指令声明所需的字段正是在这两个时机被合并进预取列表的
		ctx.before("attach-user", (session, fields) => {
			session.collect("user", session.argv, fields);
		});

		ctx.before("attach-channel", (session, fields) => {
			session.collect("channel", session.argv, fields);
		});

		registerComponents(ctx);

		// attach 完成后逐个执行快捷对话；一旦产生 response 即短路
		ctx.before("attach", (session) => {
			for (const matcher of this._matchers) {
				executeMatcher(this.ctx, session, matcher);
				if (session.response) return;
			}
		});
	}

	/**
	 * 注册中间件到 lifecycle（随调用方上下文销毁自动移除）。
	 * options 为 true 等价于 { prepend: true }。
	 */
	middleware(middleware: Middleware, options?: boolean | EventOptions) {
		const resolved: EventOptions = typeof options === "object" ? options : {};
		if (typeof options === "boolean") resolved.prepend = options;
		return this.ctx.lifecycle.register(
			"middleware",
			this._hooks,
			middleware,
			resolved,
		);
	}

	/**
	 * 注册快捷对话（pattern 命中即以 response 回复）。
	 * 返回的注销函数挂在 ctx 的 shortcut 收集器上。
	 */
	match(
		pattern: string | RegExp,
		response: Matcher.Response,
		options: Matcher.Options,
	) {
		const matcher: Matcher = {
			...options,
			context: this.ctx,
			pattern,
			response,
		};
		this._matchers.add(matcher);
		return this.ctx.collect("shortcut", () => {
			return this._matchers.delete(matcher);
		});
	}

	/**
	 * 消息事件主流程。
	 *
	 * 1. 忽略机器人自己发出的消息；
	 * 2. 登记会话、把中间件队列包装为可动态扩展的 next 链
	 *    （next(callback) 会把 callback 追加到队列尾部，深度超限报错；
	 *    会话已结束时调用 next 会抛"孤立 next"错误）；
	 * 3. 执行完毕后发送返回的文本结果；
	 * 4. finally 中注销会话、把用户/频道/群的可观察数据 diff 写回数据库，
	 *    并触发 middleware 事件（无论成功失败都执行）。
	 *
	 * SessionError 是"面向用户的错误"：转成本地化文案作为回复而非堆栈。
	 */
	private async _handleMessage(session: Session) {
		// 忽略自身的消息，避免自我循环
		if (session.selfId === session.userId) return;

		// 准备：登记会话并把各中间件绑定为待执行队列
		this._sessions[session.id] = session;
		const queue: Next.Queue = this.ctx.lifecycle
			.filterHooks(this._hooks, session)
			.map(({ callback }) => callback.bind(null, session));

		// 依次执行中间件（洋葱模型）
		let index = 0;
		const next: Next = async (callback) => {
			try {
				if (!this._sessions[session.id]) {
					throw new Error("isolated next function detected");
				}
				if (callback !== undefined) {
					queue.push((next) => Next.compose(callback, next));
					if (queue.length > Next.MAX_DEPTH) {
						throw new Error(`middleware stack exceeded ${Next.MAX_DEPTH}`);
					}
				}
				return await queue[index++]?.(next);
			} catch (error) {
				if (error instanceof SessionError) {
					// 用户可见错误：渲染 i18n 文案作为回复
					return session.text(error.path, error.param);
				}
				const stack = coerce(error);
				this.ctx.logger("session").warn(`${session.content}\n${stack}`);
			}
		};

		try {
			const result = await next();
			if (result) await session.send(result);
		} finally {
			// 更新会话登记表
			delete this._sessions[session.id];

			// 将用户 / 频道 / 群的观察数据差异写回数据库
			await session.user?.$update();
			await session.channel?.$update();
			await session.guild?.$update();
			this.ctx.emit(session, "middleware", session);
		}
	}
}
