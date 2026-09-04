// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 应用级 runtime 插件（服务名 koishi）。
 *
 * 这是 Context 构造时加载的第一个 Koishi 插件，以 cordis Service 的形式
 * 把 bot / database / session 三个 Mixin 聚合在 `ctx.koishi` 之下——
 * 即框架在 satori 之上扩展出的三类能力的运行时载体。
 * 同时导出 Koishi 生态自己的 Service 基类与 defineConfig 工具。
 */
import * as satori from "@satorijs/core";
import * as cordis from "cordis";
import BotMixin from "../bot.ts";
import DatabaseMixin from "../database/index.ts";
import SessionMixin from "../session/index.ts";
import { Context } from "./index.ts";

/**
 * Koishi 应用服务：持有根配置与三大 Mixin 实例。
 * 服务名固定为 "koishi"，注册后可通过 `ctx.koishi` 访问。
 */
export default class Koishi extends cordis.Service<
	Context.Config,
	Context
> {
	override config: Context.Config;

	/** bot 能力聚合（getGuildMemberMap / broadcast） */
	bot = new BotMixin(this.ctx);
	/** database 能力聚合（见 database/ 目录） */
	database = new DatabaseMixin(this.ctx);
	/** session 能力聚合（见 session.ts） */
	session = new SessionMixin(this.ctx);

	constructor(ctx: Context, config: Context.Config) {
		// 第二个参数为服务名，第三个 true 表示立即激活
		super(ctx, "koishi", true);
		this.config = config;
	}
}

/**
 * Koishi 生态的服务基类：在 satori.Service 的基础上，
 * 将 setup 阶段的 ctx 替换为新建的 Koishi Context，
 * 使服务内部注册的副作用挂在 Koishi 上下文体系内。
 */
export abstract class Service<
	T = unknown,
	C extends Context = Context,
> extends satori.Service<T, C> {
	override [satori.Service.setup]() {
		this.ctx = new Context() as C;
	}
}

/** 配置透传工具：对配置对象做一次类型断言（配合 ctx.plugin 使用）。 */
export function defineConfig(config: Context.Config) {
	return config;
}
