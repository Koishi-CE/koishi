// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 数据库 RPC 报文的序列化编解码（node 侧与 client 侧共享的纯协议模块）。
 *
 * 数据库方法的参数与返回值里存在 Date / bigint / Binary 等
 * JSON.stringify 无法直接保留的类型，此处统一编码为带类型前缀的
 * 字符串（s / n / b / d 前缀）。本模块不得引入任何运行时依赖
 * （node API、cosmokit、@koishi-ce/client 等）：client 侧经相对路径
 * 引用（浏览器端无 cosmokit），node 侧经 ./utils.ts 转发。
 */

/**
 * cosmokit `Binary.is` 的等价内联实现（toStringTag 判定，覆盖跨 realm
 * 场景）：node 侧免去 cosmokit 值导入，client 侧本就不依赖其运行时。
 */
function isBinary(
	value: unknown,
): value is ArrayBufferLike {
	const tag = Object.prototype.toString
		.call(value)
		.slice(8, -1);
	return (
		tag === "ArrayBuffer" || tag === "SharedArrayBuffer"
	);
}

export function serialize(obj: unknown): string {
	if (isBinary(obj)) return `"b${obj.byteLength}"`;
	if (obj instanceof Date) return `"d${obj.toJSON()}"`;
	return JSON.stringify(obj, (_, value) => {
		if (isBinary(value)) return `b${value.byteLength}`;
		if (typeof value === "string") return `s${value}`;
		if (typeof value === "bigint") return `n${value}`;
		if (typeof value === "object") {
			if (value instanceof Date)
				return `d${new Date(value).toJSON()}`;
			if (value === null) return null;
			const source = value as Record<string, unknown>;
			// 数组副本也断言为 Record：序列化层按索引写入，运行时两态皆可
			const copy = (
				Array.isArray(value) ? [] : {}
			) as Record<string, unknown>;
			for (const key in source) {
				const item = source[key];
				if (item instanceof Date) {
					const date = new Date(item) as unknown as {
						toJSON?: string | undefined;
					};
					// 置空 toJSON，使递归序列化时该值不再被压缩为 ISO 字符串。
					// Date 原型上的 toJSON 为必选方法，经 unknown 重铸为可选形态再赋值
					date.toJSON = undefined;
					copy[key] = date;
				} else {
					copy[key] = item;
				}
			}
			return copy;
		}
		return value;
	});
}

/**
 * `b` 前缀（binary 字节长度）的复活语义两侧不同：node 侧丢弃
 * （返回 undefined），client 侧还原为字节数数值。
 */
export function deserialize(
	str: string | undefined,
	reviveBinary: (length: number) => unknown = () =>
		undefined,
): unknown {
	if (str === undefined) return undefined;
	return JSON.parse(str, (_, value) => {
		if (typeof value !== "string") return value;
		const prefix = value[0];
		if (prefix === "s") return value.slice(1);
		if (prefix === "b")
			return reviveBinary(+value.slice(1));
		if (prefix === "n") return BigInt(value.slice(1));
		return new Date(value.slice(1));
	});
}
