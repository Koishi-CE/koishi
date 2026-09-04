// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { Binary } from "@koishi-ce/koishi";

/**
 * 数据库 RPC 报文的序列化编解码（node 侧）。
 *
 * 数据库方法的参数与返回值里存在 Date / bigint / Binary 等
 * JSON.stringify 无法直接保留的类型，此处统一编码为带类型前缀的
 * 字符串（s / n / b / d 前缀），由 client 侧的 deserialize 对应还原。
 */

export function serialize(obj: unknown): string {
	if (Binary.is(obj)) return `"b${obj.byteLength}"`;
	if (obj instanceof Date) return `"d${obj.toJSON()}"`;
	return JSON.stringify(obj, (_, value) => {
		if (Binary.is(value)) return `b${value.byteLength}`;
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

export function deserialize(
	str: string | undefined,
): unknown {
	if (str === undefined) return undefined;
	return JSON.parse(str, (_, value) => {
		if (typeof value !== "string") return value;
		const prefix = value[0];
		if (prefix === "s") return value.slice(1);
		if (prefix === "b") return undefined;
		if (prefix === "n") return BigInt(value.slice(1));
		return new Date(value.slice(1));
	});
}
