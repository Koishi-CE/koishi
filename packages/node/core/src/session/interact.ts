import { type Awaitable, isNullable } from "cosmokit";
import type { Middleware } from "../middleware";
import { SessionExecutable } from "./execute";
import type { PromptOptions, Session, SuggestOptions } from "./types";

/** 会话交互层：会话级中间件、追问与建议确认 */
export interface SessionInteractive extends SessionExecutable {}

export class SessionInteractive extends SessionExecutable {
	override middleware(middleware: Middleware<Session<any, any, any>>) {
		const id = this.fid;
		return this.app.middleware(async (session, next) => {
			if (id && session.fid !== id) return next();
			return middleware(session, next);
		}, true);
	}

	override prompt(timeout?: number): Promise<string | undefined>;
	override prompt<T>(
		callback: (session: Session<any, any, any>) => Awaitable<T>,
		options?: PromptOptions,
	): Promise<T>;
	override prompt(...args: any[]): any {
		const callback: (session: Session<any, any, any>) => any =
			typeof args[0] === "function"
				? args.shift()
				: (session) => {
						// Trim leading <at> element
						const elements = (session.elements ?? []).slice();
						const first = elements[0];
						if (
							first &&
							first.type === "at" &&
							first.attrs["id"] === session.selfId
						) {
							elements.shift();
						}
						return elements.join("").trim();
					};
		const options: PromptOptions =
			typeof args[0] === "number" ? { timeout: args[0] } : (args[0] ?? {});
		return new Promise<string | undefined>((resolve) => {
			const dispose = this.middleware(async (session, next) => {
				clearTimeout(timer);
				dispose();
				const value = await callback(session);
				resolve(value);
				if (isNullable(value)) return next();
			});
			const timer = setTimeout(() => {
				dispose();
				resolve(undefined);
			}, options.timeout ?? this.app.koishi.config.delay?.prompt);
		});
	}

	override async suggest(options: SuggestOptions): Promise<string | undefined> {
		let { expect, filter, prefix = "" } = options;
		if (options.actual) {
			const actual = options.actual;
			expect = expect.filter((name) => {
				return name && this.app.i18n.compare(name, actual, options);
			});
			if (filter) {
				expect = (
					await Promise.all(
						expect.map(async (name) => [name, await filter(name)] as const),
					)
				)
					.filter(([, result]) => result)
					.map(([name]) => name);
			}
		}
		if (!expect.length) {
			await this.send(prefix);
			return;
		}

		prefix += this.text("internal.suggest-hint", [
			expect
				.map((text) => {
					return this.text("general.quote", [text]);
				})
				.join(this.text("general.or")),
		]);
		if (expect.length > 1) {
			await this.send(prefix);
			return;
		}

		await this.send(prefix + options.suffix);
		return this.prompt((session): string | undefined => {
			const { content, atSelf, hasAt } = session.stripped;
			if (!atSelf && hasAt) return undefined;
			if (content === "." || content === "。") {
				return expect[0];
			}
			return undefined;
		}, options);
	}
}
