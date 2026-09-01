// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 会话基础层：来源解析与消息前缀/称呼剥离。
 *
 * 继承链的最底层，提供：
 * - resolve：计算属性求值（静态值 / minato 表达式 / 函数三态归一）；
 * - stripped：消息预处理（剥离 @机器人 / 昵称前缀，得到指令正文）；
 * - username：发送者显示名。
 */
import { type Eval, executeEval, isEvalExpr } from "minato";
import type { User } from "../database/index.ts";
import type { Session, Stripped } from "./types.ts";

/** 会话基础层：来源解析与消息前缀/称呼剥离 */
export interface SessionCore extends Session {
	/** stripped 的惰性缓存 */
	_stripped: Stripped;
}

export class SessionCore {
	/**
	 * 求值计算属性（接口说明见 types.ts 的 Session.resolve）。
	 * minato 表达式以 `{ _: this }` 为求值环境，故表达式内可用 `_` 引用会话。
	 */
	resolve<T, R extends unknown[]>(
		source: T | Eval.Expr | ((session: Session, ...args: R) => T),
		...args: R
	): T extends Eval.Expr
		? Eval<T>
		: T extends (...args: never[]) => unknown
			? ReturnType<T>
			: T;

	resolve(source: unknown, ...params: unknown[]): unknown {
		if (typeof source === "function") {
			return Reflect.apply(source as (...args: unknown[]) => unknown, null, [
				this,
				...params,
			]);
		}
		if (!isEvalExpr(source)) return source;
		return executeEval({ _: this }, source);
	}

	/**
	 * 剥离消息开头的昵称称呼（如 "kou 指令名" 中的 "kou"）。
	 *
	 * @param content 以可选 "@" 开头的消息文本
	 * @returns 剥离称呼与其后分隔符（逗号/空格）后的正文；不匹配则返回 undefined
	 */
	_stripNickname(content: string): string | undefined {
		if (content.startsWith("@")) content = content.slice(1);
		// nickname 是 Computed 配置：可以是静态数组或按会话计算的函数
		for (const nickname of this.resolve(this.app.koishi.config.nickname) ??
			[]) {
			if (!content.startsWith(nickname)) continue;
			const rest = content.slice(nickname.length);
			// 昵称后必须紧跟逗号或空白作为分隔，避免误匹配同前缀昵称
			const capture = /^([,，]\s*|\s+)/.exec(rest);
			if (!capture) continue;
			return rest.slice(capture[0].length);
		}
		return undefined;
	}

	/** @deprecated 已废弃：请改用 {@link Session.stripped}。 */
	get parsed() {
		return this.stripped;
	}

	/**
	 * 消息预处理（惰性求值并缓存）。
	 *
	 * 从消息元素序列头部剥离连续的 at 元素（包括其后可能夹杂的空白文本），
	 * 判定是否 @ 了机器人（atSelf / appel）或他人（hasAt）；
	 * 未 @ 任何人时再尝试剥离昵称称呼。得到的 content 即指令解析的输入。
	 */
	get stripped(): Stripped {
		if (this._stripped) return this._stripped;
		if (!this.elements) return {} as Stripped;

		// 剥离消息开头的 @ 元素
		let atSelf = false,
			appel = false;
		let hasAt = false;
		const elements = this.elements.slice();
		while (elements[0]?.type === "at") {
			const element = elements.shift();
			if (!element) break;
			const { attrs } = element;
			if (attrs["id"] === this.selfId) {
				atSelf = appel = true;
			}
			// 被引用消息里的 @ 不算有效称呼，只有直接 @ 别人才计入 hasAt
			if (!this.quote?.user?.id || this.quote.user.id !== attrs["id"]) {
				hasAt = true;
			}
			// @ts-expect-error
			if (elements[0]?.type === "text" && !elements[0].attrs.content.trim()) {
				elements.shift();
			}
		}

		let content = elements.join("").trim();
		if (!hasAt) {
			// 未 @ 任何人时，尝试剥离昵称称呼
			const result = this._stripNickname(content);
			if (result) {
				appel = true;
				content = result;
			}
		}

		return (this._stripped = { hasAt, content, appel, atSelf, prefix: null });
	}

	/** 发送者显示名：用户库昵称 > 作者昵称 > 作者用户名 > userId。 */
	get username(): string {
		const user = this.user as User.Observed<"name"> | undefined;
		if (user?.name) return user.name;
		return this.author.nick || this.author.name || this.userId || "";
	}
}
