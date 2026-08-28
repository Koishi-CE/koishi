import { type Context, Schema } from "@koishi-ce/koishi";

export type Config = {};

export const Config: Schema<Config> = Schema.object({});

export function apply(_ctx: Context, _config: Config) {}
