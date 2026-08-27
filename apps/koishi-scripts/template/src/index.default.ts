import { type Context, Schema } from "koishi";

export const name = "{{name}}";

export type Config = Record<string, never>;

export const Config: Schema<Config> = Schema.object({});

export function apply(_ctx: Context, _config: Config) {
	// write your plugin here
}
