import { h } from "@satorijs/core";
import { type Awaitable, makeArray } from "cosmokit";
import type { Channel, User } from "../database";
import { SessionObservable } from "./observe";

/** 会话本地化层：作用域管理与 i18n 渲染 */
export interface SessionLocalized extends SessionObservable {}

export class SessionLocalized extends SessionObservable {
	override async withScope(
		scope: string,
		callback: () => Awaitable<h[]>,
	): Promise<h[]> {
		const oldScope = this.scope;
		try {
			this.scope = scope;
			const result = await callback();
			return h.transform(
				result,
				{
					i18n: (params, children) =>
						h.i18n(
							{
								...params,
								path: this.resolveScope(params["path"]),
							},
							children,
						),
				},
				this,
			);
		} finally {
			if (oldScope === undefined) {
				delete this.scope;
			} else {
				this.scope = oldScope;
			}
		}
	}

	override resolveScope(path: string) {
		if (!path.startsWith(".")) return path;
		if (!this.scope) {
			this.app.logger("i18n").warn(new Error(`missing scope for "${path}"`));
			return "";
		}
		return this.scope + path;
	}

	override text(path: string | string[], params: object = {}) {
		return this.i18n(path, params).join("");
	}

	override i18n(path: string | string[], params: object = {}) {
		const locales: string[] = [
			...((this.channel as Channel.Observed)?.locales || []),
			...((this.guild as Channel.Observed)?.locales || []),
		];
		if (this.app.koishi.config.i18n?.output === "prefer-user") {
			locales.unshift(...((this.user as User.Observed)?.locales || []));
		} else {
			locales.push(...((this.user as User.Observed)?.locales || []));
		}
		locales.unshift(...(this.locales || []));
		const paths = makeArray(path).map((path) => this.resolveScope(path));
		return this.app.i18n.render(locales, paths, params);
	}
}
