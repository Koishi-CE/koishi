import { type Context, Schema } from "koishi";

export const name = "@@SHORTNAME@@";

export type Config = Record<string, never>;

export const Config: Schema<Config> = Schema.object({});

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 源码是 ESM，用 import.meta.url 定位；构建为 CJS 后 rolldown 的
// import.meta.url 垫片指向产物文件，../client 仍落在项目根的 client/。
const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../client");

export function apply(ctx: Context, _config: Config) {
    ctx.inject(["console"], (ctx) => {
        ctx.console.addEntry({
            dev: resolve(clientRoot, "index.ts"),
            prod: resolve(clientRoot, "../dist"),
        });
    });
}
