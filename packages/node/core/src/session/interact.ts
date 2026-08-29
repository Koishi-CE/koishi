/**
 * 会话交互层：会话级中间件、一次性追问与纠错建议。
 *
 * 继承链最顶层。middleware 注册只对当前会话生效的临时中间件；
 * prompt 基于它实现"等待用户下一条消息"；suggest 组合 i18n 模糊
 * 匹配与 prompt，实现"您要找的是不是……回复句号确认"的交互。
 */
import { type Awaitable, isNullable } from "cosmokit";
import type { Middleware } from "../middleware/index.ts";
import { SessionExecutable } from "./execute.ts";
import type { PromptOptions, Session, SuggestOptions } from "./types.ts";

/** 会话交互层：会话级中间件、追问与建议确认 */
export interface SessionInteractive extends SessionExecutable {}

export class SessionInteractive extends SessionExecutable {
	/**
	 * 注册只对当前会话生效的临时中间件（按会话 fid 匹配），
	 * 内部通过 `app.middleware(..., true)` 以前置方式挂载。
	 */
	override middleware(middleware: Middleware) {
		const id = this.fid;
		return this.app.middleware(async (session, next) => {
			if (id && session.fid !== id) return next();
			return middleware(session, next);
		}, true);
	}

	/**
	 * 一次性提问：注册临时中间件等待当前用户的下一条消息。
	 *
	 * 无回调重载直接返回去前缀后的消息文本；
	 * 回调返回 null/undefined 视为"未消费"，继续传递给后续中间件。
	 * 超时后注销中间件并 resolve(undefined)。
	 */
	override prompt(timeout?: number): Promise<string | undefined>;
	override prompt<T>(
		callback: (session: Session) => Awaitable<T>,
		options?: PromptOptions,
	): Promise<T>;
	override prompt(...args: unknown[]): unknown {
		const callback: (session: Session) => Awaitable<unknown> =
			typeof args[0] === "function"
				? (args.shift() as (session: Session) => Awaitable<unknown>)
				: (session) => {
						// 剥离消息开头 @机器人 的元素，只留正文
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
				// 实现内部仅以文本兑现；重载泛型 T 的兑现值由签名表达
				resolve(value as string | undefined);
				if (isNullable(value)) return next();
			});
			const timer = setTimeout(() => {
				dispose();
				resolve(undefined);
			}, options.timeout ?? this.app.koishi.config.delay?.prompt);
		});
	}

	/**
	 * 发送纠错建议。
	 *
	 * 将用户输入（actual）与候选列表（expect）模糊比对并过滤，
	 * 生成"你是不是想输入：xxx"提示；恰好剩一个候选时额外等待用户
	 * 输入 `.`（或 `。`）确认并返回该候选，其余情况返回 undefined。
	 */
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
			// 多候选无法自动确认，只提示
			await this.send(prefix);
			return;
		}

		await this.send(prefix + options.suffix);
		// 用户 @ 了别人（而非机器人）时不视为确认，继续等待直到超时
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
