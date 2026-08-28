import { type Eval, executeEval, isEvalExpr } from "minato";
import type { User } from "../database";
import type { Session, Stripped } from "./types";

/** 会话基础层：来源解析与消息前缀/称呼剥离 */
export interface SessionCore extends Session {
	_stripped: Stripped;
}

export class SessionCore {
	resolve<T, R extends any[]>(
		source:
			| T
			| Eval.Expr
			| ((session: Session<any, any, any>, ...args: R) => T),
		...args: R
	): T extends Eval.Expr
		? Eval<T>
		: T extends (...args: any[]) => any
			? ReturnType<T>
			: T;

	resolve(source: any, ...params: any[]) {
		if (typeof source === "function") {
			return Reflect.apply(source, null, [this, ...params]);
		}
		if (!isEvalExpr(source)) return source;
		return executeEval({ _: this }, source);
	}

	_stripNickname(content: string): string | undefined {
		if (content.startsWith("@")) content = content.slice(1);
		for (const nickname of this.resolve(this.app.koishi.config.nickname) ??
			[]) {
			if (!content.startsWith(nickname)) continue;
			const rest = content.slice(nickname.length);
			const capture = /^([,，]\s*|\s+)/.exec(rest);
			if (!capture) continue;
			return rest.slice(capture[0].length);
		}
		return undefined;
	}

	/** @deprecated */
	get parsed() {
		return this.stripped;
	}

	get stripped(): Stripped {
		if (this._stripped) return this._stripped;
		if (!this.elements) return {} as Stripped;

		// strip mentions
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
			// quote messages may contain mentions
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
			// strip nickname
			const result = this._stripNickname(content);
			if (result) {
				appel = true;
				content = result;
			}
		}

		return (this._stripped = { hasAt, content, appel, atSelf, prefix: null });
	}

	get username(): string {
		const user = this.user as User.Observed<"name"> | undefined;
		if (user?.name) return user.name;
		return this.author.nick || this.author.name || this.userId || "";
	}
}
