import type { Context } from "../context";
import type { Argv } from "./parser";

// https://github.com/microsoft/TypeScript/issues/17002
// it never got fixed so we have to do this
const isArray = Array.isArray as (arg: any) => arg is readonly any[];

const BRACKET_REGEXP = /<[^>]+>|\[[^\]]+\]/g;

export interface DeclarationList extends Array<Argv.Declaration> {
	stripped: string;
}

export function resolveDomain(ctx: Context, type: Argv.Type | undefined) {
	if (typeof type === "function") {
		return { transform: type };
	} else if (type instanceof RegExp) {
		const transform = (source: string) => {
			if (type.test(source)) return source;
			throw new Error();
		};
		return { transform };
	} else if (isArray(type)) {
		const transform = (source: string) => {
			if (type.includes(source)) return source;
			throw new Error();
		};
		return { transform };
	} else if (typeof type === "object") {
		return type ?? {};
	}
	return ctx.get(`domain:${type}`) ?? {};
}

export function parseValue(
	ctx: Context,
	source: string,
	kind: string,
	argv: Argv,
	decl: Argv.Declaration = {},
) {
	const { name, type = "string" } = decl;

	// apply domain callback
	const domain = resolveDomain(ctx, type);
	try {
		return domain.transform(source, argv.session);
	} catch (err) {
		if (!argv.session) {
			argv.error = `internal.invalid-${kind}`;
		} else {
			const message = argv.session.text(
				(err as Error).message || "internal.check-syntax",
			);
			argv.error = argv.session.text(`internal.invalid-${kind}`, [
				name,
				message,
			]);
		}
	}
}

export function parseDecl(ctx: Context, source: string): DeclarationList {
	let cap: RegExpExecArray | null;
	const result: DeclarationList = Object.assign([], { stripped: "" });
	// eslint-disable-next-line no-cond-assign
	while ((cap = BRACKET_REGEXP.exec(source))) {
		let rawName = cap[0].slice(1, -1);
		let variadic = false;
		if (rawName.startsWith("...")) {
			rawName = rawName.slice(3);
			variadic = true;
		}
		const [name, rawType] = rawName.split(":");
		const type = rawType ? (rawType.trim() as Argv.DomainType) : undefined;
		result.push({
			variadic,
			required: cap[0][0] === "<",
			...(name !== undefined ? { name } : {}),
			...(type !== undefined ? { type } : {}),
		});
	}
	result.stripped = source
		.replace(/:[\w-]+(?=[>\]])/g, (str) => {
			const domain = ctx.get(`domain:${str.slice(1)}`);
			return domain?.greedy ? "..." : "";
		})
		.trimEnd();
	return result;
}
