import { type Context, Schema } from "@koishi-ce/koishi";
import { resolve } from "path";
import { ConfigWriter, ServiceProvider } from "../shared";
import { PackageProvider } from "./packages";

export * from "../shared";

export const name = "config";
export const inject = ["console"];

export type Config = {};

export const Config: Schema<Config> = Schema.object({});

export function apply(ctx: Context) {
	if (!ctx.loader?.writable) {
		return ctx
			.logger("app")
			.warn(
				"@koishi-ce/plugin-config is only available for json/yaml config file",
			);
	}

	ctx.plugin(PackageProvider);
	ctx.plugin(ServiceProvider);
	ctx.plugin(ConfigWriter);

	ctx.console.addEntry({
		dev: resolve(__dirname, "../../client/index.ts"),
		prod: resolve(__dirname, "../../dist"),
	});
}
