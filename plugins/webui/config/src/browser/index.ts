import { type Context, Schema } from "@koishi-ce/koishi";
import { ConfigWriter, ServiceProvider } from "../shared";
import { PackageProvider } from "./packages";

export * from "../shared";

export const name = "config";
export const inject = ["console", "loader"];

export type Config = {};

export const Config: Schema<Config> = Schema.object({});

export function apply(ctx: Context, config: Config) {
	ctx.plugin(PackageProvider);
	ctx.plugin(ConfigWriter);
	ctx.plugin(ServiceProvider);

	ctx.console.addEntry(
		process.env.KOISHI_BASE
			? [
					process.env.KOISHI_BASE + "/dist/index.js",
					process.env.KOISHI_BASE + "/dist/style.css",
				]
			: [
					// @ts-expect-error
					import.meta.url.replace(/\/src\/[^/]+\/[^/]+$/, "/client/index.ts"),
				],
	);
}
