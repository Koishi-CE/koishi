// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 会话本地化层：i18n 作用域管理与文案渲染。
 *
 * withScope 为指令执行建立文案作用域（相对路径自动拼接 scope 前缀）；
 * i18n / text 按"频道 -> 群 -> 用户"的优先级合并语言偏好后
 * 委托 app.i18n 渲染。
 */
import { h } from "@satorijs/core";
import { type Awaitable, makeArray } from "cosmokit";
import type { Channel, User } from "../database/index.ts";
import { SessionObservable } from "./observe.ts";

/** 会话本地化层：作用域管理与 i18n 渲染 */
export interface SessionLocalized extends SessionObservable {}

export class SessionLocalized extends SessionObservable {
	/**
	 * 在指定 i18n 作用域内执行回调。
	 *
	 * 回调产出的元素树中的 i18n 元素会被改写：相对路径（以 `.` 开头）
	 * 解析为 `scope + path`，使指令内部文案无需写完整路径。
	 * finally 中恢复原作用域（原本无作用域则删除该属性）。
	 */
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

	/**
	 * 解析 i18n 路径：相对路径（`.` 开头）拼上当前 scope；
	 * 没有 scope 却收到相对路径时报警告并返回空串（渲染为空文案）。
	 */
	override resolveScope(path: string) {
		if (!path.startsWith(".")) return path;
		if (!this.scope) {
			this.app.logger("i18n").warn(new Error(`missing scope for "${path}"`));
			return "";
		}
		return this.scope + path;
	}

	/** 以纯文本渲染 i18n 文案（拼接各片段，不保留元素结构）。 */
	override text(path: string | string[], params: object = {}) {
		return this.i18n(path, params).join("");
	}

	/**
	 * 渲染 i18n 文案：按频道 -> 群 -> 用户的顺序合并语言偏好，
	 * （output 为 prefer-user 时用户语言优先级提到最前），
	 * 最后会话自带 locales 永远最优先，再交由 app.i18n 渲染。
	 */
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
