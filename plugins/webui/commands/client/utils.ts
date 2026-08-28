import { Schema, store } from "@koishi-ce/client";

export function assignSchema(schema: Schema, value: any) {
	if (schema.type === "intersect" || schema.type === "union") {
		for (const item of schema.list ?? []) {
			assignSchema(item, value);
		}
	} else if (schema.type === "object" && schema.dict) {
		const { dict } = schema;
		for (const key in value) {
			const item = dict[key];
			if (!item) continue;
			dict[key] = item.default(value[key]);
		}
	}
}

export function createSchema(name: string, value: any) {
	// store 中缺失时回退到空对象，与 new Schema(undefined) 的运行时行为一致（空 schema）
	const result = new Schema(store.schema?.[name] ?? {});
	if (!value) return result;
	assignSchema(result, value);
	return result;
}
