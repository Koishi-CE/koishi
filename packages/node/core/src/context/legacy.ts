// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 已废弃事件 API 的兼容实现（waterfall / chain）。
 *
 * 二者都是"瀑布式"事件：按监听器顺序依次调用，前一个的返回值
 * 作为下一个的首个参数，最终返回链末结果。区别仅在于同步 / 异步。
 * 新代码应使用 cordis 原生的 `ctx.serial`（异步串行）/ `ctx.bail`（短路）。
 */
import type { Context } from "./index.ts";

/**
 * 解析重载参数：若首参是对象或函数则视为 thisArg 并从参数列表中移除，
 * 剩余首参即事件名（两个 Impl 共用的约定，见 Context.waterfall / chain 重载）。
 */
/** @deprecated 已废弃：请改用 `ctx.serial` / `ctx.bail`。 */
export async function waterfallImpl(
	ctx: Context,
	args: [unknown, ...unknown[]],
): Promise<unknown> {
	const first = args[0];
	const thisArg =
		typeof first === "object" || typeof first === "function"
			? (args.shift() as object)
			: null;
	const name = args.shift() as string;
	for (const hook of ctx.lifecycle.filterHooks(
		ctx.lifecycle._hooks[name] || [],
		// 无 thisArg 时为 null（与 cordis dispatch 的取参逻辑一致，其内部以 ?. 兼容）
		thisArg as object | undefined,
	)) {
		const result = await hook.callback.apply(thisArg, args);
		// 上一个监听器的返回值作为下一个的首个实参（瀑布语义）
		args[0] = result;
	}
	return args[0];
}

/** @deprecated 已废弃：同步版瀑布事件，请改用 `ctx.bail`。 */
export function chainImpl(
	ctx: Context,
	args: [unknown, ...unknown[]],
): unknown {
	const first = args[0];
	const thisArg =
		typeof first === "object" || typeof first === "function"
			? (args.shift() as object)
			: null;
	const name = args.shift() as string;
	for (const hook of ctx.lifecycle.filterHooks(
		ctx.lifecycle._hooks[name] || [],
		// 无 thisArg 时为 null（与 cordis dispatch 的取参逻辑一致，其内部以 ?. 兼容）
		thisArg as object | undefined,
	)) {
		const result = hook.callback.apply(thisArg, args);
		args[0] = result;
	}
	return args[0];
}
