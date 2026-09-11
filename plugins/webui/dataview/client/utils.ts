// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * dataview 客户端工具：RPC 报文的查询封装与展示辅助。
 *
 * serialize / deserialize 的编解码协议与 node 侧共享（../src/codec.ts
 * 纯协议模块，相对路径引入以保证两侧实现同源），差异仅在 binary 分支：
 * 客户端把 `"b<len>"` 还原为字节数数值（node 侧丢弃为 undefined）。
 */

import { message, send } from "@koishi-ce/client";
import type { Database } from "@koishi-ce/koishi";
import type { Methods } from "@koishi-ce/plugin-dataview";
import {
	deserialize as deserializeBase,
	serialize,
} from "../src/codec.ts";

export { serialize };

export function deserialize(
	str: string | undefined,
): unknown {
	return deserializeBase(str, (length) => length);
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
