// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * Context（上下文）模块入口——Koishi 框架的组装中枢。
 *
 * cordis 的 Context 是依赖注入容器中的"作用域句柄"，插件通过它注册
 * 事件、服务和副作用，销毁时自动回收。本文件在其上叠加 Koishi 的组装逻辑：
 * 构造一个 Context 即得到一个完整的应用实例（内置 minato 数据库、
 * 指令系统、过滤器、i18n、权限、schema 等核心服务）。
 *
 * 同时这里也是核心类型的再导出枢纽：satori 协议层类型（Bot、h、HTTP 等）、
 * cordis 作用域类型（EffectScope 等）与各子模块的类型都从本文件汇出。
 *
 * 同目录其它文件：config.ts（配置 Schema 定义）、legacy.ts（waterfall/chain
 * 兼容事件实现）、runtime.ts（应用级 runtime 插件）。
 */
import * as satori from "@satorijs/core";
import { type HTTP, Schema } from "@satorijs/core";
import type * as cordis from "cordis";
import type { GetEvents, Parameters, ReturnType, ThisType } from "cordis";
import type { Promisify } from "cosmokit";
import * as minato from "minato";
import { Commander } from "../command/index.ts";
import { type Computed, FilterService } from "../filter.ts";
import { I18n } from "../i18n/index.ts";
import { Processor } from "../middleware/index.ts";
import { Permissions } from "../permission.ts";
import { SchemaService } from "../schema.ts";
import type { Session } from "../session/index.ts";
import { defineContextConfig } from "./config.ts";
import { chainImpl, waterfallImpl } from "./legacy.ts";
import Koishi from "./runtime.ts";

/** cordis 副作用作用域（本框架 Context 特化） */
export type EffectScope = cordis.EffectScope<Context>;
/** cordis 分叉作用域：插件被多次载入时每个配置项对应一个 fork */
export type ForkScope = cordis.ForkScope<Context>;
/** cordis 主作用域：插件定义所在的原始作用域 */
export type MainScope = cordis.MainScope<Context>;

export type { Component, Fragment, Render } from "@satorijs/core";
export {
	Adapter,
	Bot,
	Element,
	HTTP,
	h,
	Logger,
	MessageEncoder,
	Messenger,
	Quester,
	Schema,
	segment,
	Universal,
	z,
} from "@satorijs/core";
export type { Disposable, Plugin, ScopeStatus } from "cordis";
export { resolveConfig } from "cordis";

/** 环境数据占位类型（Koishi 未使用 satori 的 EnvData，保留以兼容）。 */
export type EnvData = object;

/** 从字符串类型 S 中删去子串 T（用于从 "before-" 事件名反推原事件名）。 */
type OmitSubstring<
	S extends string,
	T extends string,
> = S extends `${infer L}${T}${infer R}` ? `${L}${R}` : never;
/** 所有带 "before-" 前缀的事件去掉前缀后的事件名 */
type BeforeEventName = OmitSubstring<keyof Events & string, "before-">;
/** before 事件名到监听器签名的映射（见 Context.before） */
type BeforeEventMap = {
	[E in keyof Events & string as OmitSubstring<E, "before-">]: Events[E];
};

/** Koishi 事件表：在 cordis 事件的基础上由各模块 declare module 陆续扩充。 */
export interface Events<C extends Context = Context> extends cordis.Events<C> {}

/** Koishi 上下文接口：各模块通过 declare module 向 Context 合并成员。 */
export interface Context {
	[Context.events]: Events<this>;
	[Context.session]: Session<never, never, this>;
	/** 应用级 Koishi 实例（runtime 插件），持有全局配置与生命周期 */
	koishi: Koishi;
}

/**
 * Koishi 应用上下文：继承 satori Context，在构造时装配全部核心服务。
 * 一个 Context 实例即一个 Koishi 应用（App 是它的历史别名）。
 */
export class Context extends satori.Context {
	/**
	 * shadow 会话标记：以其它会话为模板派生的"影子会话"会带上该符号属性，
	 * 权限校验等场景据此还原出原始会话（见 permission.ts 的 test）。
	 */
	static shadow = Symbol.for("session.shadow");

	// 值侧由类静态承载,类型侧见下方 namespace(erasableSyntaxOnly 不允许 namespace 内运行时值)
	static Config = Schema.intersect([
		Schema.object({}),
	]) as unknown as Context.Config.Static;

	constructor(config: Context.Config = {}) {
		super(config);
		// 把各服务的方法混入 Context 原型，形成 ctx.match / ctx.command 等快捷 API
		this.mixin("$processor", ["match", "middleware"]);
		this.mixin("$filter", [
			"any",
			"never",
			"union",
			"intersect",
			"exclude",
			"user",
			"self",
			"guild",
			"channel",
			"platform",
			"private",
		]);
		this.mixin("$commander", ["command"]);
		// 注册核心服务（true 表示不可被同名服务覆盖）
		this.provide("$filter", new FilterService(this), true);
		this.provide("schema", new SchemaService(this), true);
		this.provide("$processor", new Processor(this), true);
		this.provide("i18n", new I18n(this, this.config.i18n), true);
		this.provide("permissions", new Permissions(this), true);
		// model / http 先占位，待数据库驱动 / 网络层插件注入实现
		this.provide("model", undefined, true);
		this.provide("http", undefined, true);
		this.provide("$commander", new Commander(this, this.config), true);
		this.plugin(
			minato.Database as unknown as cordis.Plugin.Constructor<Context>,
		);
		this.plugin(Koishi, this.config);
	}

	/** @deprecated 已废弃：请改用 `ctx.root`。 */
	get app() {
		return this.root;
	}

	/** @deprecated 已废弃：请改用 `koishi.config`。 */
	get options() {
		return this.root.config;
	}

	/** @deprecated 已废弃：请改用 `ctx.serial`。 */
	waterfall<K extends keyof GetEvents<this>>(
		name: K,
		...args: Parameters<GetEvents<this>[K]>
	): Promisify<ReturnType<GetEvents<this>[K]>>;
	waterfall<K extends keyof GetEvents<this>>(
		thisArg: ThisType<GetEvents<this>[K]>,
		name: K,
		...args: Parameters<GetEvents<this>[K]>
	): Promisify<ReturnType<GetEvents<this>[K]>>;
	waterfall(...args: [unknown, ...unknown[]]) {
		return waterfallImpl(this, args);
	}

	/** @deprecated 已废弃：瀑布式事件已由 `ctx.serial` 取代。 */
	chain<K extends keyof GetEvents<this>>(
		name: K,
		...args: Parameters<GetEvents<this>[K]>
	): ReturnType<GetEvents<this>[K]>;
	chain<K extends keyof GetEvents<this>>(
		thisArg: ThisType<GetEvents<this>[K]>,
		name: K,
		...args: Parameters<GetEvents<this>[K]>
	): ReturnType<GetEvents<this>[K]>;
	chain(...args: [unknown, ...unknown[]]) {
		return chainImpl(this, args);
	}

	/**
	 * 注册某事件的"前置"监听器：`before('command/x')` 等价于
	 * 监听 `command/before-x`（只改写路径最后一段）。
	 *
	 * @param append 默认 false（前置插入，即真正"抢跑"于普通监听器）
	 */
	before<K extends BeforeEventName>(
		name: K,
		listener: BeforeEventMap[K],
		append = false,
	) {
		const seg = (name as string).split("/");
		seg[seg.length - 1] = `before-${seg[seg.length - 1]}`;
		// 动态拼出的 "before-" 事件名无法用 K 的字面量重载表达，
		// 退化为运行时事件总线签名调用（与 cordis 内部实现签名一致）
		const on = this.on as (
			name: string,
			listener: unknown,
			options?: boolean,
		) => () => boolean;
		return on(seg.join("/"), listener, !append);
	}
}

export * from "./runtime.ts";
export { default } from "./runtime.ts";

export namespace Context {
	/** 应用根配置（基础 + 高级 + i18n / 延迟 / 网络请求）。 */
	export interface Config extends Config.Basic, Config.Advanced {
		/** 国际化配置 */
		i18n?: I18n.Config;
		/** 各类消息延迟设置（防风控节流） */
		delay?: Config.Delay;
		/** 全局网络请求配置 */
		request?: HTTP.Config;
	}

	export namespace Config {
		/** 基础配置：指令系统配置加机器人称呼、授权等通用项。 */
		export interface Basic extends Commander.Config {
			/** 机器人昵称：用户以该称呼开头即可免前缀触发指令（Computed） */
			nickname?: string | string[];
			/** 频道初次收到消息时是否自动指派给机器人（入库，Computed） */
			autoAssign?: Computed<boolean>;
			/** 新用户的初始权限等级（Computed） */
			autoAuthorize?: Computed<number>;
			/** 指令纠错建议的相似度阈值（见 i18n compare） */
			minSimilarity?: number;
		}

		/** 延迟配置：控制各类发送行为的节流间隔（毫秒）。 */
		export interface Delay {
			/** 排队发送时每字符追加的延迟（乘以消息长度） */
			character?: number;
			/** 排队发送时每条消息的基础延迟 */
			message?: number;
			/** cancelQueued 后恢复发送前的等待 */
			cancel?: number;
			/** broadcast 广播相邻两条消息的间隔 */
			broadcast?: number;
			/** prompt 等待用户回复的超时 */
			prompt?: number;
		}

		/** 高级配置。 */
		export interface Advanced {
			/** 单个事件的最大监听器数量（超出告警） */
			maxListeners?: number;
		}

		/** Config Schema 的运行时形态：携带各分段 Schema 便于控制台分组渲染。 */
		export interface Static extends Schema<Config> {
			list: Schema[];
			Basic: Schema<Basic>;
			I18n: Schema<I18n>;
			Delay: Schema<Delay>;
			Advanced: Schema<Advanced>;
		}
	}
}

defineContextConfig(Context.Config);

// 会话过滤挂载：cordis 事件分发时以 session[Context.filter](hookCtx) 判定
// 监听器所在上下文是否放行本会话，缺失会导致 $filter / ctx.user 等选择器全部失效
// （Context.filter 是 cordis 的 unique symbol，Session 类型上无对应索引，需断言）
Object.assign(satori.Session.prototype, {
	[Context.filter](this: Session, ctx: Context) {
		return ctx.filter(this);
	},
});

// bot 销毁防护：cordis 卸载 fiber 按注册顺序进行，satori 服务在 Context 构造时
// 最早注册、也最先卸载，其后业务插件（如 adapter / mock）的 bot dispose 回调
// 再读 this.ctx.bots 已是 undefined，而 satori 4.6.0 的 Bot.dispose 未像 status
// setter 那样做可选链防护，导致 app.stop() 时抛 TypeError（已实证）。
// 包一层防护：bots 服务仍在位时走原逻辑，否则跳过列表摘除直接停机。
// 若后续升级 @satorijs/core 修复了该缺陷，可移除本补丁。
const botDispose = satori.Bot.prototype.dispose;
satori.Bot.prototype.dispose = function (this: satori.Bot) {
	if (!this.ctx.bots) return this.stop();
	return botDispose.call(this);
};

// 向后兼容：历史上应用类名为 App
export { Context as App };
