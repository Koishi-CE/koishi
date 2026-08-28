import { type Fragment, h } from "@satorijs/core";
import type { Awaitable } from "cosmokit";
import type { Context } from "../context";
import type { Session } from "../session";

export interface Matcher extends Matcher.Options {
	context: Context;
	pattern: string | RegExp;
	response: Matcher.Response;
}

export namespace Matcher {
	export type Response =
		| Fragment
		| ((
				session: Session,
				params: [string, ...string[]],
		  ) => Awaitable<Fragment>);

	export interface Options {
		i18n?: boolean;
		appel?: boolean;
		fuzzy?: boolean;
		regex?: boolean;
	}
}

export function executeMatcher(
	ctx: Context,
	session: Session,
	matcher: Matcher,
) {
	const { stripped, quote } = session;
	const { appel, context, i18n, regex, fuzzy, pattern, response } = matcher;
	if ((appel || stripped.hasAt) && !stripped.appel) return;
	if (!context.filter(session)) return;
	let content = stripped.content;
	if (quote?.content) content += " " + quote.content;

	const match = (pattern: any): [string, ...string[]] | null => {
		if (!pattern) return null;
		if (typeof pattern === "string") {
			if ((!fuzzy && content !== pattern) || !content.startsWith(pattern))
				return null;
			const rest = content.slice(pattern.length);
			if (fuzzy && !stripped.appel && rest.match(/^\S/)) {
				return null;
			}
			return [content, rest];
		} else {
			return pattern.exec(content);
		}
	};

	let params: [string, ...string[]] | null = null;
	if (!i18n) {
		params = match(pattern);
	} else {
		for (const locale of ctx.i18n.fallback([])) {
			const store = ctx.i18n._data[locale];
			let value = store?.[pattern as string] as string | RegExp;
			if (!value) continue;
			if (regex) {
				const rest = fuzzy
					? `(?:${stripped.appel ? "" : "\\s+"}([\\s\\S]*))?`
					: "";
				value = new RegExp(`^(?:${value})${rest}$`);
			}
			params = match(value);
			if (!params) continue;
			session.locales = [locale];
			break;
		}
	}

	if (!params) return;
	const captured = params;
	session.response = async () => {
		const output = await session.resolve(response, captured);
		return h.normalize(
			output,
			captured.map((source) => (source ? h.parse(source) : "")),
		);
	};
}
