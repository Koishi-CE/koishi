import type { Context, Dict, Schema } from "@koishi-ce/koishi";
import { DataService } from "./service";

export class SchemaProvider extends DataService<Dict<Schema>> {
	constructor(ctx: Context) {
		super(ctx, "schema", { immediate: true });

		ctx.on("internal/schema", () => this.refresh());
	}

	override async get() {
		return this.ctx.schema._data;
	}
}
