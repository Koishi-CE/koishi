// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { Schema, store } from "@koishi-ce/client";

/**
 * 递归地为复合 Schema（intersect / union / object）的叶子节点回填默认值。
 * 用于让由「类型名」反查出的 Schema 与实际数据形状对齐，
 * 这样 k-form 才能正确渲染表单控件。
 * @param schema 目标 Schema
 * @param value 与该 Schema 对应的数据
 */
export function assignSchema(schema: Schema, value: object) {
	if (schema.type === "intersect" || schema.type === "union") {
		for (const item of schema.list ?? []) {
			assignSchema(item, value);
		}
	} else if (schema.type === "object" && schema.dict) {
		const { dict } = schema;
		for (const key in value) {
			const item = dict[key];
			if (!item) continue;
			dict[key] = item.default((value as Record<string, unknown>)[key]);
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
