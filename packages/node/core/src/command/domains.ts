/**
 * 内置参数类型（domain）注册表与选项权限 schema。
 *
 * domain 是命令参数 / 选项的类型系统：声明中 `<foo:number>` 的 "number"
 * 即在此注册。每个 domain 是一个 transform 函数（字符串 → 实际取值），
 * 配合 greedy（贪婪匹配剩余全部）/ numeric（允许 "-1" 形式的负数）
 * 两个行为开关。插件可通过 ctx.$commander.domain() 覆盖或扩展。
 */

import { h, Schema, Time } from "@satorijs/core";
import type { Commander } from "./index.ts";
import type { Argv } from "./parser/index.ts";

/**
 * 注册一种「元素属性」domain：把输入解析为指定类型的消息元素
 * （如 img / audio），成功时返回元素的 attrs 对象。
 * @param name 注册的 domain 名
 * @param key 报错时使用的文案键（默认同 name）
 * @param type 要求的元素类型（默认同 name）
 */
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
			// 数字允许 "," 与 "_" 作为千位分隔符（如 1,000 / 1_000）
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
			// "value * 0 === 0" 排除 NaN 与 Infinity，再校验整数性
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

	// user / channel：支持 "@id"、"#id" 简写与 at / sharp 元素三种写法，
	// 归一为 "platform:id" 形式的全局标识
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

/** 选项的权限相关 schema（控制台 command-option 配置面板使用） */
export const commandOptionSchema = Schema.object({
	permissions: Schema.array(String)
		.role("perms")
		.default(["authority:0"])
		.description("权限继承。"),
	dependencies: Schema.array(String).role("perms").description("权限依赖。"),
});
