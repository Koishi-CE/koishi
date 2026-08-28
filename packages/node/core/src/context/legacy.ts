import type { Context } from "./index";

/** @deprecated use `ctx.serial` / `ctx.bail` instead */
export async function waterfallImpl(
	ctx: Context,
	args: [any, ...any[]],
): Promise<unknown> {
	const thisArg =
		typeof args[0] === "object" || typeof args[0] === "function"
			? args.shift()
			: null;
	const name = args.shift();
	for (const hook of ctx.lifecycle.filterHooks(
		ctx.lifecycle._hooks[name] || [],
		thisArg,
	)) {
		const result = await hook.callback.apply(thisArg, args);
		args[0] = result;
	}
	return args[0];
}

/** @deprecated */
export function chainImpl(ctx: Context, args: [any, ...any[]]): unknown {
	const thisArg =
		typeof args[0] === "object" || typeof args[0] === "function"
			? args.shift()
			: null;
	const name = args.shift();
	for (const hook of ctx.lifecycle.filterHooks(
		ctx.lifecycle._hooks[name] || [],
		thisArg,
	)) {
		const result = hook.callback.apply(thisArg, args);
		args[0] = result;
	}
	return args[0];
}
