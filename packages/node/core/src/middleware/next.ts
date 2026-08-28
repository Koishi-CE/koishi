import type { Fragment } from "@satorijs/core";
import { type Awaitable, type Dict, makeArray } from "cosmokit";
import type { Session } from "../session";

export class SessionError extends Error {
	path: string | string[];
	param?: Dict | undefined;

	constructor(path: string | string[], param?: Dict) {
		super(makeArray(path)[0] ?? "");
		this.path = path;
		this.param = param;
	}
}

export type Next = (next?: Next.Callback) => Promise<void | Fragment>;
export type Middleware<S extends Session<any, any, any> = Session> = (
	session: S,
	next: Next,
) => Awaitable<void | Fragment>;

export namespace Next {
	export type Queue = ((next?: Next) => Awaitable<void | Fragment>)[];
	export type Callback =
		| void
		| string
		| ((next?: Next) => Awaitable<void | Fragment>);
}

export const Next = {
	MAX_DEPTH: 64,

	async compose(callback: Next.Callback, next?: Next) {
		return typeof callback === "function" ? callback(next) : callback;
	},
};
