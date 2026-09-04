// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * Next 调度工具与中间件类型定义。
 *
 * 中间件（Middleware）是洋葱模型的节点：收到 (session, next)，
 * 处理后可选地调用 next() 把控制权交给后续中间件。
 * `Next.Callback` 允许 next() 携带参数：传函数相当于动态追加中间件，
 * 传字符串则直接作为该中间件的返回值（见 index.ts 的 next 实现）。
 */
import type { Fragment } from "@satorijs/core";
import {
	type Awaitable,
	type Dict,
	makeArray,
} from "cosmokit";
import type { Session } from "../session/index.ts";

/**
 * 会话级业务错误：message 是 i18n 路径而非用户可读文本。
 * 中间件处理器捕获后按用户语言渲染成文案回复（见 index.ts），
 * 从而把"指令参数不合法"等提示纳入 i18n 体系。
 */
export class SessionError extends Error {
	/** 错误文案的 i18n 路径 */
	path: string | string[];
	/** 文案插值参数 */
	param?: Dict | undefined;

	constructor(path: string | string[], param?: Dict) {
		super(makeArray(path)[0] ?? "");
		this.path = path;
		this.param = param;
	}
}

/** next 函数：可选传入回调（追加中间件）或字符串（直接作为返回值） */
// biome-ignore lint/suspicious/noConfusingVoidType: 公共 API：返回 void 表示不发送、Fragment 表示回复，改为 undefined 会破坏 void 返回中间件的可赋值性
export type Next = (
	next?: Next.Callback,
) => Promise<void | Fragment>;
/** 中间件签名：返回 Fragment 表示要发送给用户的内容 */
export type Middleware<S extends Session = Session> = (
	session: S,
	next: Next,
	// biome-ignore lint/suspicious/noConfusingVoidType: 公共 API：返回 void 表示透传、Fragment 表示回复，改为 undefined 会破坏 void 返回中间件的可赋值性
) => Awaitable<void | Fragment>;

export namespace Next {
	/** 中间件执行队列（每个元素绑定好 session，只差 next 引用） */
	// biome-ignore lint/suspicious/noConfusingVoidType: 公共 API：返回 void 表示透传，改为 undefined 会破坏 void 返回中间件的可赋值性
	export type Queue = ((
		next?: Next,
	) => Awaitable<void | Fragment>)[];
	/** next 的入参：void（直接放行）/ 字符串（本层返回值）/ 函数（追加一层） */
	export type Callback =
		// biome-ignore lint/suspicious/noConfusingVoidType: 公共 API：返回 void 表示透传，改为 undefined 会破坏 void 返回中间件的可赋值性
		| void
		| string
		| ((next?: Next) => Awaitable<void | Fragment>);
}

export const Next = {
	/** next(callback) 动态追加的最大深度（防无限递归） */
	MAX_DEPTH: 64,

	/** 归一化 next 入参：函数原样调用，字符串直接返回。 */
	async compose(callback: Next.Callback, next?: Next) {
		return typeof callback === "function"
			? callback(next)
			: callback;
	},
};
