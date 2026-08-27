import { resolve } from "node:path";
import { type Context, Schema } from "koishi";

export const name = "{{name}}";

export type Config = Record<string, never>;

export const Config: Schema<Config> = Schema.object({});

export function apply(ctx: Context, _config: Config) {
	ctx.inject(["console"], (ctx) => {
		ctx.console.addEntry({
			dev: resolve(__dirname, "../client/index.ts"),
			prod: resolve(__dirname, "../dist"),
		});
	});
}
