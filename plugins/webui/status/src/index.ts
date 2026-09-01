// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * status 插件（node 侧）入口。
 *
 * 插件本体拆分为两个 DataService 子服务：
 * - EnvInfoProvider（envinfo）：一次性采集运行环境信息（OS / CPU / Node / 包管理器等）；
 * - ProfileProvider（profile）：周期性采集性能数据（CPU / 内存 / 各机器人收发消息速率）。
 *
 * 本文件负责注册控制台前端资源入口、以子插件形式挂载上述两个服务，
 * 并合并两者的 Config Schema 作为插件整体配置。
 */

import { resolve } from "node:path";
import type {} from "@koishi-ce/console";
import { type Context, Schema } from "@koishi-ce/koishi";
import EnvInfoProvider from "./envinfo.ts";
import ProfileProvider from "./profile.ts";

/** 频道活跃度记录：键为小时数（0~23），值为该小时内触发频道的次数。 */
export type Activity = Record<number, number>;

declare module "@koishi-ce/koishi" {
	interface Channel {
		name: string;
		activity: Activity;
	}
}

declare module "@koishi-ce/console" {
	namespace Console {
		interface Services {
			envinfo: EnvInfoProvider;
			status: ProfileProvider;
		}
	}
}

export * from "./envinfo.ts";
export * from "./profile.ts";
export { EnvInfoProvider, ProfileProvider };

export const name = "status";
export const inject = ["console"];

export interface Config
	extends ProfileProvider.Config,
		EnvInfoProvider.Config {}

export const Config: Schema<Config> = Schema.intersect([
	EnvInfoProvider.Config,
	ProfileProvider.Config,
]);

/**
 * 插件入口：注册控制台前端资源（dev 指向 client 源码，prod 指向构建产物），
 * 再将环境信息与性能采集两个服务作为子插件挂载，共享同一份配置。
 *
 * @param ctx 应用上下文
 * @param config 插件配置（两个子服务配置的交集合并）
 */
export function apply(ctx: Context, config: Config) {
	ctx.console.addEntry({
		dev: resolve(__dirname, "../client/index.ts"),
		prod: resolve(__dirname, "../dist"),
	});

	ctx.plugin(EnvInfoProvider, config);
	ctx.plugin(ProfileProvider, config);
}
