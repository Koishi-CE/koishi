// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import {
	type Dict,
	Schema,
	store,
} from "@koishi-ce/client";
import type { Argv, Command } from "@koishi-ce/koishi";
import type { CommandState } from "@koishi-ce/plugin-commands";

/**
 * 递归地为复合 Schema（intersect / union / object）的叶子节点回填默认值。
 * 用于让由「类型名」反查出的 Schema 与实际数据形状对齐，
 * 这样 k-form 才能正确渲染表单控件。
 * @param schema 目标 Schema
 * @param value 与该 Schema 对应的数据
 */
export function assignSchema(
	schema: Schema,
	value: object,
) {
	if (
		schema.type === "intersect" ||
		schema.type === "union"
	) {
		for (const item of schema.list ?? []) {
			assignSchema(item, value);
		}
	} else if (schema.type === "object" && schema.dict) {
		const { dict } = schema;
		for (const key in value) {
			const item = dict[key];
			if (!item) continue;
			dict[key] = item.default(
				(value as Record<string, unknown>)[key],
			);
		}
	}
}

/**
 * 按名称从全局 store 反查 Schema 并绑定初始值。
 * @param name Schema 的注册名（如 "command"、"command-option"）
 * @param value 该 Schema 对应的初始数据；传入时自动回填默认值
 * @returns 可直接交给 k-form 渲染的 Schema 实例
 */
export function createSchema(name: string, value: object) {
	// store 中缺失时回退到空对象，与 new Schema(undefined) 的运行时行为一致（空 schema）
	const result = new Schema(store.schema?.[name] ?? {});
	if (!value) return result;
	assignSchema(result, value);
	return result;
}

// 浏览器端工程中 send() 的事件类型取自 "@koishi-ce/plugin-console" 的 Events
// （本插件 node 侧的声明挂在 "@koishi-ce/console"，经 lib 产物 d.ts 的跨文件
// declare module 增强在浏览器端类型程序不可靠），在此按 src/index.ts 的
// declare module "@koishi-ce/console" 逐事件同签名镜像，两处须保持同步。
// 与 plugin-config 的 client/components/utils.ts 为同一模式。
declare module "@koishi-ce/plugin-console" {
	interface Events {
		"command/create"(name: string): void;
		"command/remove"(name: string): void;
		"command/update"(
			name: string,
			config: Pick<CommandState, "config" | "options">,
		): void;
		"command/teleport"(name: string, parent: string): void;
		"command/aliases"(
			name: string,
			aliases: Dict<Command.Alias>,
		): void;
		"command/parse"(name: string, source: string): Argv;
	}
}
