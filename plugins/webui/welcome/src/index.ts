// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * welcome 插件（node 侧）入口。
 *
 * 本插件的全部逻辑位于浏览器端：前端（client/index.ts）注入 7 语种词典，
 * 并把欢迎卡片（含 Lottie 开屏描线动画）挂到控制台首页的 home 插槽。
 * Node 侧仅向 console 注册浏览器侧入口资源，不承载任何其它逻辑。
 */

import { resolve } from "node:path";
import { type Context, Schema } from "@koishi-ce/koishi";
import type {} from "@koishi-ce/plugin-console";

export const name = "welcome";

export const inject = ["console"];

/** 插件配置：当前无可用配置项。 */
export type Config = Record<never, never>;

export const Config: Schema<Config> = Schema.object({});

/** 插件入口：向 console 注册浏览器侧入口资源。 */
export function apply(ctx: Context) {
	ctx.console.addEntry(
		process.env["KOISHI_BASE"]
			? [
					`${process.env["KOISHI_BASE"]}/dist/index.js`,
					`${process.env["KOISHI_BASE"]}/dist/style.css`,
				]
			: process.env["KOISHI_ENV"] === "browser"
				? [
						import.meta.url.replace(
							/\/src\/[^/]+$/,
							"/client/index.ts",
						),
					]
				: {
						dev: resolve(__dirname, "../client/index.ts"),
						prod: resolve(__dirname, "../dist"),
					},
	);
}
