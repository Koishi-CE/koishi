import { type Context, Schema } from "koishi";

export const name = "@@SHORTNAME@@";

export type Config = Record<string, never>;

export const Config: Schema<Config> = Schema.object({});

export function apply(ctx: Context, _config: Config) {
    ctx.logger("@@SHORTNAME@@").info("插件已加载");
}
