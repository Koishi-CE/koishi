/**
 * config 插件的 Node 端入口。
 *
 * 前置检查 loader 的可写性（只有 koishi.yml / koishi.json 这类文件型
 * 配置才支持网页编辑），随后挂载三个数据服务（插件包元数据、服务状态、
 * 配置写入器），并把 client 目录注册为控制台前端入口。
 */
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
	// 仅文件型配置(可写)支持本插件,其余环境(如环境变量驱动)直接跳过
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

	// 注册控制台前端资源:dev 模式直接指向 client 源码,prod 指向打包产物
	ctx.console.addEntry({
		dev: resolve(__dirname, "../../client/index.ts"),
		prod: resolve(__dirname, "../../dist"),
	});
}
