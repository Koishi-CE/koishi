import { h, Schema, Time } from "@satorijs/core";
import type { Commander } from "./index";
import type { Argv } from "./parser";

function defineElementDomain(
	cmdr: Commander,
	name: keyof Argv.Domain,
	key = name,
	type = name,
) {
	cmdr.domain(name, (source, _session) => {
		const code = h.from(source, { type });
		if (code && code.type === type) {
			return code.attrs;
		}
		throw new Error(`internal.invalid-${key}`);
	});
}

/** 注册内置参数类型（domain）表 */
export function registerBuiltinDomains(cmdr: Commander) {
	cmdr.domain("el", (source) => h.parse(source), { greedy: true });
	cmdr.domain("elements", (source) => h.parse(source), { greedy: true });
	cmdr.domain("string", (source) => h.unescape(source));
	cmdr.domain("text", (source) => h.unescape(source), { greedy: true });
	cmdr.domain("rawtext", (source) => h("", h.parse(source)).toString(true), {
		greedy: true,
	});
	cmdr.domain("boolean", () => true);

	cmdr.domain(
		"number",
		(source, _session) => {
			// support `,` and `_` as delimiters
			// https://github.com/koishijs/koishi/issues/1386
			const value = +source.replace(/[,_]/g, "");
			if (Number.isFinite(value)) return value;
			throw new Error("internal.invalid-number");
		},
		{ numeric: true },
	);

	cmdr.domain(
		"integer",
		(source, _session) => {
			const value = +source.replace(/[,_]/g, "");
			if (value * 0 === 0 && Math.floor(value) === value) return value;
			throw new Error("internal.invalid-integer");
		},
		{ numeric: true },
	);

	cmdr.domain(
		"posint",
		(source, _session) => {
			const value = +source.replace(/[,_]/g, "");
			if (value * 0 === 0 && Math.floor(value) === value && value > 0)
				return value;
			throw new Error("internal.invalid-posint");
		},
		{ numeric: true },
	);

	cmdr.domain(
		"natural",
		(source, _session) => {
			const value = +source.replace(/[,_]/g, "");
			if (value * 0 === 0 && Math.floor(value) === value && value >= 0)
				return value;
			throw new Error("internal.invalid-natural");
		},
		{ numeric: true },
	);

	cmdr.domain(
		"bigint",
		(source, _session) => {
			try {
				return BigInt(source.replace(/[,_]/g, ""));
			} catch {
				throw new Error("internal.invalid-integer");
			}
		},
		{ numeric: true },
	);

	cmdr.domain("date", (source, _session) => {
		const timestamp = Time.parseDate(source);
		if (+timestamp) return timestamp;
		throw new Error("internal.invalid-date");
	});

	cmdr.domain("user", (source, session) => {
		if (source.startsWith("@")) {
			source = source.slice(1);
			if (source.includes(":")) return source;
			return `${session.platform}:${source}`;
		}
		const code = h.from(source);
		if (code && code.type === "at") {
			return `${session.platform}:${code.attrs["id"]}`;
		}
		throw new Error("internal.invalid-user");
	});

	cmdr.domain("channel", (source, session) => {
		if (source.startsWith("#")) {
			source = source.slice(1);
			if (source.includes(":")) return source;
			return `${session.platform}:${source}`;
		}
		const code = h.from(source);
		if (code && code.type === "sharp") {
			return `${session.platform}:${code.attrs["id"]}`;
		}
		throw new Error("internal.invalid-channel");
	});

	defineElementDomain(cmdr, "image", "image", "img");
	defineElementDomain(cmdr, "img", "image", "img");
	defineElementDomain(cmdr, "audio");
	defineElementDomain(cmdr, "video");
	defineElementDomain(cmdr, "file");
}

export const commandOptionSchema = Schema.object({
	permissions: Schema.array(String)
		.role("perms")
		.default(["authority:0"])
		.description("权限继承。"),
	dependencies: Schema.array(String).role("perms").description("权限依赖。"),
});
