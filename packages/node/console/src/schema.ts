/**
 * 内置数据服务：Schema 注册表提供者。
 *
 * 将应用内全部已注册的 Schema（配置描述符）下发给控制台前端，
 * 供配置界面动态渲染表单；schema 注册变动时自动刷新。
 */

import type { Context, Dict, Schema } from "@koishi-ce/koishi";
import { DataService } from "./service";

export class SchemaProvider extends DataService<Dict<Schema>> {
	constructor(ctx: Context) {
		super(ctx, "schema", { immediate: true });

		// Schema 注册表发生增删时重新下发全量数据
		ctx.on("internal/schema", () => this.refresh());
	}

	override async get() {
		return this.ctx.schema._data;
	}
}
