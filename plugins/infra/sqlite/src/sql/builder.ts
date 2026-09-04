// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * SQLite 方言的 SQL 生成器（minato 3 / @minatojs/sql-utils v5）。
 *
 * 上游脉络同 src/index.ts：cordis 3 线 4.7.0 与 cordis 4 线 5.1.1 的
 * 合并改写。$log 算子取 4 线的 `ln()` 写法（自然对数，与 memory
 * 驱动的 Math.log 一致；3 线的 `log()` 在 SQLite 中实为 log10）。
 * 4 线的 uuid transformer 与 $startsWith 算子未回移——minato 3 的
 * 字段类型与查询算子面均无对应概念。
 */
import { Builder, escapeId } from "@minatojs/sql-utils";
import type { Dict } from "cosmokit";
import { Binary, isNullable } from "cosmokit";
import type {
	Driver,
	Eval,
	Model,
	RegExpLike,
} from "minato";
import { Field, isEvalExpr, randomId, Type } from "minato";

export class SQLiteBuilder extends Builder {
	// SQLite 字符串字面量只认单引号翻倍转义，不认反斜杠
	protected override escapeMap = {
		"'": "''",
	};

	constructor(driver: Driver, tables?: Dict<Model>) {
		super(driver, tables);

		// $regexFor：字段值当正则、给定值当被测串（与 $regex 方向相反）。
		// 带忽略大小写时走 regexp2 双参通道（函数见 setup/functions.ts）
		this.queryOperators.$regexFor = (key, value) =>
			typeof value === "string"
				? `${this.escape(value)} regexp ${key}`
				: value.flags?.includes("i")
					? `regexp2(${key}, ${this.escape(value.input)}, 'i')`
					: `${this.escape(value.input)} regexp ${key}`;

		this.evalOperators.$if = (args) =>
			`iif(${args.map((arg) => this.parseEval(arg)).join(", ")})`;
		// $regex 求值侧：与查询侧同构的双函数通道
		this.evalOperators.$regex = ([key, value, flags]) => {
			const reg = value as string | RegExp;
			const selfFlags =
				reg instanceof RegExp ? reg.flags : undefined;
			if (
				flags?.includes("i") ||
				selfFlags?.includes("i")
			) {
				return `regexp2(${this.parseEval(reg)}, ${this.parseEval(key)}, ${this.escape(flags ?? selfFlags ?? "")})`;
			}
			return `regexp(${this.parseEval(reg)}, ${this.parseEval(key)})`;
		};

		this.evalOperators.$concat = (args) =>
			`(${args.map((arg) => this.parseEval(arg)).join("||")})`;
		// 取模走自定义函数：内建 % 不传播 NULL，语义与 minato 不符
		this.evalOperators.$modulo = ([left, right]) =>
			`modulo(${this.parseEval(left)}, ${this.parseEval(right)})`;
		// 自然对数（3 线的 log() 在 SQLite 实为 log10，取 4 线的 ln 写法）
		this.evalOperators.$log = ([left, right]) =>
			isNullable(right)
				? `ln(${this.parseEval(left)})`
				: `ln(${this.parseEval(left)}) / ln(${this.parseEval(right)})`;
		// list 长度：JSON 存储态直接数组取长；逗号分隔态按分隔符计数
		// （LENGTH - LENGTH(REPLACE) + 1），聚合与标量双通道见 createAggr
		this.evalOperators.$length = (expr) =>
			this.createAggr(
				expr,
				(value) => `count(${value})`,
				(value) =>
					this.isEncoded()
						? this.jsonLength(value)
						: this.asEncoded(
								`iif(${value}, LENGTH(${value}) - LENGTH(REPLACE(${value}, ${this.escape(",")}, ${this.escape("")})) + 1, 0)`,
								false,
							),
			);
		// 转数值求值：日期族存的是毫秒，先归一到秒；空值兜底 0
		this.evalOperators.$number = (arg) => {
			const type = Type.fromTerm(arg);
			const value = this.parseEval(arg);
			const res = Field.date.includes(type.type)
				? `cast(${value} / 1000 as integer)`
				: `cast(${this.parseEval(arg)} as double)`;
			return this.asEncoded(`ifnull(${res}, 0)`, false);
		};

		// 成员判断（$in / $nin）按目标形态分四路，见 createMemberEval；
		// 结果包 JSON 数组统一成单标量
		this.evalOperators.$in = ([key, value]) =>
			this.asEncoded(
				this.createMemberEval(key, value, ""),
				false,
			);
		this.evalOperators.$nin = ([key, value]) =>
			this.asEncoded(
				this.createMemberEval(key, value, " NOT"),
				false,
			);

		// SQLite 无按位异或运算符：布尔态用不等号链，整数态展开为
		// (a & ~b) | (~a & b) 等价复合
		const binaryXor = (left: string, right: string) =>
			`((${left} & ~${right}) | (~${left} & ${right}))`;
		this.evalOperators.$xor = (args) => {
			const type = Type.fromTerm(
				this.state.expr,
				Type.Boolean,
			);
			if (Field.boolean.includes(type.type)) {
				return args
					.map((arg) => this.parseEval(arg))
					.reduce((prev, curr) => `(${prev} != ${curr})`);
			} else {
				return args
					.map((arg) => this.parseEval(arg))
					.reduce((prev, curr) => binaryXor(prev, curr));
			}
		};
		// JSON 路径取值：字符串键走 `-> '$.key'`，动态键拼接路径字符串
		this.evalOperators.$get = ([x, key]) =>
			typeof key === "string"
				? this.asEncoded(
						`(${this.parseEval(x, false)} -> '$.${key}')`,
						true,
					)
				: this.asEncoded(
						`(${this.parseEval(x, false)} -> ('$[' || ${this.parseEval(key)} || ']'))`,
						true,
					);

		// bigint 列在 SQL 表达式侧以字符串往返（cast），绕开浮点精度丢失
		this.transformers["bigint"] = {
			encode: (value) => `cast(${value} as text)`,
			decode: (value) => `cast(${value} as integer)`,
			load: (value) =>
				isNullable(value) ? value : BigInt(value),
			dump: (value) =>
				isNullable(value) ? value : `${value}`,
		};

		// binary 列在 SQL 表达式侧以 hex 文本往返（unhex 还原）
		this.transformers["binary"] = {
			encode: (value) => `hex(${value})`,
			decode: (value) => `unhex(${value})`,
			load: (value) =>
				isNullable(value) || typeof value === "object"
					? value
					: Binary.fromHex(value),
			dump: (value) =>
				isNullable(value) || typeof value === "string"
					? value
					: Binary.toHex(value),
		};
	}

	/** 字面量转义：日期出毫秒数、正则出 source、二进制出 X'hex' 裸字面量。 */
	override escapePrimitive(value: unknown, type?: Type) {
		if (value instanceof Date) value = +value;
		else if (value instanceof RegExp) value = value.source;
		else if (Binary.is(value))
			return `X'${Binary.toHex(value)}'`;
		else if (Binary.isSource(value))
			return `X'${Binary.toHex(Binary.fromSource(value))}'`;
		return super.escapePrimitive(value, type);
	}

	/**
	 * 成员判断（$in / $nin 共用）按目标形态分四路：
	 * 数组拼 IN 列表（嵌套数组为多列元组）；$exec 走子查询；
	 * list 类型字段走 LIKE 通道；其余（json 数组）走自定义
	 * contains 函数。notStr 非空时对结果取逻辑非。
	 */
	protected createMemberEval(
		rawKey: unknown,
		value: unknown,
		notStr = "",
	) {
		const key = this.parseEval(rawKey, false);
		if (Array.isArray(value)) {
			if (!value.length)
				return notStr ? this.$true : this.$false;
			if (Array.isArray(value[0])) {
				return `(${key})${notStr} in (${value
					.map(
						(val: unknown[]) =>
							`(${val.map((x) => this.escape(x)).join(", ")})`,
					)
					.join(", ")})`;
			}
			return `${key}${notStr} in (${value.map((val) => this.escape(val)).join(", ")})`;
		} else if ((value as Dict)["$exec"]) {
			return `(${key})${notStr} in ${this.parseSelection((value as Dict)["$exec"], true)}`;
		} else if (
			(Type.fromTerm(value as Eval.Term<unknown>)
				?.type as string) === "list"
		) {
			const res = this.listContains(
				this.parseEval(value),
				key,
			);
			return notStr ? this.logicalNot(res) : res;
		} else {
			const res = this.jsonContains(
				this.parseEval(value, false),
				isEvalExpr(rawKey)
					? this.encode(key, true, true)
					: this.escape(rawKey, "json"),
			);
			return notStr ? this.logicalNot(res) : res;
		}
	}

	/** $el（list 元素匹配）：json 列走 contains 函数，list 列走逗号包裹 LIKE。 */
	protected override createElementQuery(
		key: string,
		value: unknown,
	) {
		if (this.isJsonQuery(key)) {
			return this.jsonContains(
				key,
				this.escape(value, "json"),
			);
		} else {
			return `(',' || ${key} || ',') LIKE ${this.escape(`%,${value},%`)}`;
		}
	}

	/** 查询侧 $regex：与求值侧同构的双函数通道（见 evalOperators.$regex）。 */
	protected override createRegExpQuery(
		key: string,
		value: string | RegExpLike,
	) {
		if (
			typeof value !== "string" &&
			value.flags?.includes("i")
		) {
			return `regexp2(${this.escape(typeof value === "string" ? value : value.source)}, ${key}, ${this.escape(value.flags)})`;
		} else {
			return `regexp(${this.escape(typeof value === "string" ? value : value.source)}, ${key})`;
		}
	}

	/** list 字段包含：两端补逗号后 LIKE，避免子串误命中（"b" 不匹配 "abc"）。 */
	protected override listContains(
		list: string,
		value: string,
	) {
		return `(',' || ${list} || ',') LIKE '%,' || ${value} || ',%'`;
	}

	protected override jsonLength(value: string) {
		return this.asEncoded(
			`json_array_length(${value})`,
			false,
		);
	}

	/** json 数组包含：委派 setup/functions.ts 注册的同名自定义函数。 */
	protected override jsonContains(
		obj: string,
		value: string,
	) {
		return this.asEncoded(
			`json_array_contains(${obj}, ${value})`,
			false,
		);
	}

	/**
	 * 编码态（JSON 存储列）的标量还原：`->> '$'` 取出 JSON 标量后按
	 * 类型 decode，使其以原生标量参与后续 SQL 表达式。
	 */
	protected override encode(
		value: string,
		encoded: boolean,
		pure: boolean = false,
		type?: Type,
	) {
		return encoded
			? super.encode(value, encoded, pure, type)
			: encoded === this.isEncoded() && !pure
				? value
				: this.asEncoded(
						this.transform(
							`(${value} ->> '$')`,
							type,
							"decode",
						),
						pure ? undefined : false,
					);
	}

	/**
	 * 无 GROUP BY 时的聚合退化：SQLite 聚合函数不吃数组参数，改写成
	 * json_each 展开的关联子查询（尾随 randomId 作表别名防重）。
	 */
	protected override createAggr(
		expr: unknown,
		aggr: (value: string) => string,
		nonaggr?: (value: string) => string,
	) {
		if (!this.state.group && !nonaggr) {
			const value = this.parseEval(expr, false);
			return `(select ${aggr(escapeId("value"))} from json_each(${value}) ${randomId()})`;
		} else {
			return super.createAggr(expr, aggr, nonaggr);
		}
	}

	/** 聚合为数组：group_concat 手工拼 JSON 数组字面量，空集兜底 json_array()。 */
	protected override groupArray(value: string) {
		const res = this.isEncoded()
			? `('[' || group_concat(${value}) || ']')`
			: `('[' || group_concat(json_quote(${value})) || ']')`;
		return this.asEncoded(
			`ifnull(${res}, json_array())`,
			true,
		);
	}

	/** JSON 字段访问出 `->` 路径表达式（保留 JSON 形态，配 encode 做标量还原）。 */
	protected override transformJsonField(
		obj: string,
		path: string,
	) {
		return this.asEncoded(`(${obj} -> '$${path}')`, true);
	}
}
