// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * dataview 客户端工具：RPC 报文的序列化编解码、查询封装与展示辅助。
 *
 * serialize / deserialize 与 node 侧 src/utils.ts 的编码协议保持一致
 * （s / n / b / d 类型前缀字符串），差异仅在 binary 分支：客户端把
 * `"b<len>"` 还原为字节数数值（node 侧丢弃为 undefined）。
 */

import { message, send } from "@koishi-ce/client";
import type { Database } from "@koishi-ce/koishi";
import type { Methods } from "@koishi-ce/plugin-dataview";

/**
 * cosmokit `Binary.is` 的等价内联实现（跨 realm 的 toStringTag 判定，
 * 覆盖其 instanceof 分支）：浏览器端工程不直接依赖 cosmokit 运行时。
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
					// 置空 toJSON，使递归序列化时该值不再被压缩为 ISO 字符串
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
		if (prefix === "b") return +value.slice(1);
		if (prefix === "n") return BigInt(value.slice(1));
		return new Date(value.slice(1));
	});
}

/** 经 `database/*` RPC 事件调用服务端数据库方法（参数与返回值自动编解码） */
export async function sendQuery<K extends Methods>(
	name: K,
	...args: Parameters<Database[K]>
): Promise<ReturnType<Database[K]>> {
	// send 的重载在泛型模板串事件名上会落入 string 实现签名（与 spread 的
	// string[] 参数无法对上），收敛为 database/* 专用的具体签名调用
	const request = send as (
		event: `database/${Methods}`,
		...args: string[]
	) => Promise<string | undefined>;
	const data = await request(
		`database/${name}`,
		...args.map(serialize),
	);
	return deserialize(data) as ReturnType<Database[K]>;
}

/** 把字节数格式化为带单位的可读字符串 */
export function formatSize(size: number) {
	const units = ["B", "KB", "MB", "GB"];
	let index = 0;
	while (index < units.length - 1 && size > 1024) {
		size /= 1024;
		index++;
	}
	return `${+size.toFixed(1)} ${units[index]}`;
}

/** 把异常转为一条错误提示（前缀 msg 为场景说明，自动补全角冒号） */
export function handleError(e: unknown, msg = "") {
	console.warn(e);
	if (msg.length) msg += "：";
	if (e instanceof Error) {
		msg += e.name;
	} else if (typeof e === "string") {
		msg += e.split("\n")[0] ?? "";
	}
	return message.error(msg);
}

function pad0(n: number) {
	return n.toString().padStart(2, "0");
}

/** 时分秒（hh:mm:ss），用于 time 类型字段的展示 */
export function timeStr(date: Date) {
	return [
		pad0(date.getHours()),
		pad0(date.getMinutes()),
		pad0(date.getSeconds()),
	].join(":");
}

/** 年月日（yyyy-MM-dd），用于 date 类型字段的展示 */
export function dateStr(date: Date) {
	return [
		pad0(date.getFullYear()),
		pad0(date.getMonth() + 1),
		pad0(date.getDate()),
	].join("-");
}
