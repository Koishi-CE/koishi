import type * as satori from "@satorijs/core";
import type { Fragment, h, Universal } from "@satorijs/core";
import type { Awaitable } from "cosmokit";
import type { Eval } from "minato";
import type { Argv } from "../command";
import type { Context } from "../context";
import type { Channel, Tables, User } from "../database";
import type { CompareOptions } from "../i18n";
import type { Middleware, Next } from "../middleware";

export interface PromptOptions {
	timeout?: number;
}

export interface SuggestOptions extends CompareOptions {
	actual?: string;
	expect: readonly string[];
	filter?: (name: string) => Awaitable<boolean>;
	prefix?: string;
	suffix: string;
	timeout?: number;
}

export interface Stripped {
	content: string;
	prefix: string | null;
	appel: boolean;
	hasAt: boolean;
	atSelf: boolean;
}

export type FieldCollector<
	T extends keyof Tables,
	K = keyof Tables[T],
	A extends any[] = any[],
	O extends {} = {},
> =
	| Iterable<K>
	| ((argv: Argv<never, never, A, O>, fields: Set<keyof Tables[T]>) => void);

export function collectFields<T extends keyof Tables>(
	argv: Argv,
	collectors: FieldCollector<T>[],
	fields: Set<any>,
) {
	for (const collector of collectors) {
		if (typeof collector === "function") {
			collector(argv, fields);
			continue;
		}
		for (const field of collector) {
			fields.add(field);
		}
	}
	return fields;
}

export interface Session<
	U extends User.Field = never,
	G extends Channel.Field = never,
	C extends Context = Context,
> extends satori.Session<C> {
	argv?: Argv<U, G>;
	user?: User.Observed<U>;
	channel?: Channel.Observed<G>;
	guild?: Channel.Observed<G>;
	permissions: string[];
	scope?: string;
	response?: () => Promise<Fragment>;
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
	stripped: Stripped;
	username: string;
	send(fragment: Fragment, options?: Universal.SendOptions): Promise<string[]>;
	cancelQueued(delay?: number): void;
	sendQueued(content: Fragment, delay?: number): Promise<string[] | undefined>;
	getChannel<K extends Channel.Field = never>(
		id?: string,
		fields?: K[],
	): Promise<Channel>;
	observeChannel<T extends Channel.Field = never>(
		fields: Iterable<T>,
	): Promise<Channel.Observed<T | G>>;
	getUser<K extends User.Field = never>(
		userId?: string,
		fields?: K[],
	): Promise<User>;
	observeUser<T extends User.Field = never>(
		fields: Iterable<T>,
	): Promise<User.Observed<T | U>>;
	withScope(scope: string, callback: () => Awaitable<h[]>): Promise<h[]>;
	resolveScope(path: string): string;
	text(path: string | string[], params?: object): string;
	i18n(path: string | string[], params?: object): h[];
	collect<T extends "user" | "channel">(
		key: T,
		argv: Argv | undefined,
		fields?: Set<keyof Tables[T]>,
	): Set<keyof Tables[T]>;
	execute(content: string | Argv, next?: true | Next): Promise<h[]>;
	middleware(middleware: Middleware<Session<any, any, any>>): () => boolean;
	prompt(timeout?: number): Promise<string | undefined>;
	prompt<T>(
		callback: (session: Session<any, any, any>) => Awaitable<T>,
		options?: PromptOptions,
	): Promise<T>;
	suggest(options: SuggestOptions): Promise<string | undefined>;
}
