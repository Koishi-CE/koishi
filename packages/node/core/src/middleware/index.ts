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
		$processor: Processor;
		middleware<S extends Session = Session>(
			middleware: Middleware<S>,
			prepend?: boolean,
		): () => boolean;
		match(
			pattern: string | RegExp,
			response: Matcher.Response,
			options?: Matcher.Options & { i18n?: false },
		): () => boolean;
		match(
			pattern: string,
			response: string,
			options: Matcher.Options & { i18n: true },
		): () => boolean;
	}

	interface Events {
		"before-attach-channel"(session: Session, fields: Set<Channel.Field>): void;
		"attach-channel"(session: Session): Awaitable<void | boolean>;
		"before-attach-user"(session: Session, fields: Set<User.Field>): void;
		"attach-user"(session: Session): Awaitable<void | boolean>;
		"before-attach"(session: Session): void;
		attach(session: Session): void;
		middleware(session: Session): void;
	}
}

export class Processor {
	_hooks: Hook[] = [];
	_sessions: Dict<Session> = Object.create(null);
	_matchers = new Set<Matcher>();

	private ctx: Context;

	constructor(ctx: Context) {
		this.ctx = ctx;
		defineProperty(this, Context.current, ctx);

		// bind built-in event listeners
		this.middleware(
			(session, next) => attachSession(this.ctx, session, next),
			true,
		);
		ctx.on("message", this._handleMessage.bind(this));

		ctx.before("attach-user", (session, fields) => {
			session.collect("user", session.argv, fields);
		});

		ctx.before("attach-channel", (session, fields) => {
			session.collect("channel", session.argv, fields);
		});

		registerComponents(ctx);

		ctx.before("attach", (session) => {
			for (const matcher of this._matchers) {
				executeMatcher(this.ctx, session, matcher);
				if (session.response) return;
			}
		});
	}

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

	private async _handleMessage(session: Session) {
		// ignore self messages
		if (session.selfId === session.userId) return;

		// preparation
		this._sessions[session.id] = session;
		const queue: Next.Queue = this.ctx.lifecycle
			.filterHooks(this._hooks, session)
			.map(({ callback }) => callback.bind(null, session));

		// execute middlewares
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
			// update session map
			delete this._sessions[session.id];

			// flush user & group data
			await session.user?.$update();
			await session.channel?.$update();
			await session.guild?.$update();
			this.ctx.emit(session, "middleware", session);
		}
	}
}
