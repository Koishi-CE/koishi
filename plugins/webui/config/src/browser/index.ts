// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * config 插件的浏览器端入口。
 *
 * 与 node 入口共用 shared 的三个数据服务，差别在于：
 * 1. 额外注入 loader 服务；
 * 2. 前端资源不走 addEntry 的 dev/prod 约定，而是显式给出资源 URL——
 *    设置了 KOISHI_BASE 环境变量时从远端加载打包产物，否则回退到
 *    client 源码（供开发调试用）。
 */
import { type Context, Schema } from "@koishi-ce/koishi";
import {
	ConfigWriter,
	ServiceProvider,
} from "../shared/index.ts";
import { PackageProvider } from "./packages.ts";

export * from "../shared/index.ts";

export const name = "config";
export const inject = ["console", "loader"];

export type Config = Record<never, never>;

export const Config: Schema<Config> = Schema.object({});

export function apply(ctx: Context) {
	ctx.plugin(PackageProvider);
	ctx.plugin(ConfigWriter);
	ctx.plugin(ServiceProvider);

	ctx.console.addEntry(
		process.env["KOISHI_BASE"]
			? [
					`${process.env["KOISHI_BASE"]}/dist/index.js`,
					`${process.env["KOISHI_BASE"]}/dist/style.css`,
				]
			: [
					import.meta.url.replace(
						/\/src\/[^/]+\/[^/]+$/,
						"/client/index.ts",
					),
				],
	);
}
