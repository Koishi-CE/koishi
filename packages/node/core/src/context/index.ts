import * as satori from "@satorijs/core";
import { type HTTP, Schema } from "@satorijs/core";
import type * as cordis from "cordis";
import type { GetEvents, Parameters, ReturnType, ThisType } from "cordis";
import type { Promisify } from "cosmokit";
import * as minato from "minato";
import { Commander } from "../command";
import { type Computed, FilterService } from "../filter";
import { I18n } from "../i18n";
import { Processor } from "../middleware";
import { Permissions } from "../permission";
import { SchemaService } from "../schema";
import type { Session } from "../session";
import { defineContextConfig } from "./config";
import { chainImpl, waterfallImpl } from "./legacy";
import Koishi from "./runtime";

export type EffectScope = cordis.EffectScope<Context>;
export type ForkScope = cordis.ForkScope<Context>;
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

export type EnvData = {};

type OmitSubstring<
	S extends string,
	T extends string,
> = S extends `${infer L}${T}${infer R}` ? `${L}${R}` : never;
type BeforeEventName = OmitSubstring<keyof Events & string, "before-">;
type BeforeEventMap = {
	[E in keyof Events & string as OmitSubstring<E, "before-">]: Events[E];
};

export interface Events<C extends Context = Context> extends cordis.Events<C> {}

export interface Context {
	[Context.events]: Events<this>;
	[Context.session]: Session<never, never, this>;
	koishi: Koishi;
}

export class Context extends satori.Context {
	static shadow = Symbol.for("session.shadow");

	// 值侧由类静态承载,类型侧见下方 namespace(erasableSyntaxOnly 不允许 namespace 内运行时值)
	static Config = Schema.intersect([
		Schema.object({}),
	]) as unknown as Context.Config.Static;

	constructor(config: Context.Config = {}) {
		super(config);
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
		this.provide("$filter", new FilterService(this), true);
		this.provide("schema", new SchemaService(this), true);
		this.provide("$processor", new Processor(this), true);
		this.provide("i18n", new I18n(this, this.config.i18n), true);
		this.provide("permissions", new Permissions(this), true);
		this.provide("model", undefined, true);
		this.provide("http", undefined, true);
		this.provide("$commander", new Commander(this, this.config), true);
		this.plugin(
			minato.Database as unknown as cordis.Plugin.Constructor<Context>,
		);
		this.plugin(Koishi, this.config);
	}

	/** @deprecated use `ctx.root` instead */
	get app() {
		return this.root;
	}

	/** @deprecated use `koishi.config` instead */
	get options() {
		return this.root.config;
	}

	/** @deprecated use `ctx.serial` instead */
	waterfall<K extends keyof GetEvents<this>>(
		name: K,
		...args: Parameters<GetEvents<this>[K]>
	): Promisify<ReturnType<GetEvents<this>[K]>>;
	waterfall<K extends keyof GetEvents<this>>(
		thisArg: ThisType<GetEvents<this>[K]>,
		name: K,
		...args: Parameters<GetEvents<this>[K]>
	): Promisify<ReturnType<GetEvents<this>[K]>>;
	waterfall(...args: [any, ...any[]]) {
		return waterfallImpl(this, args);
	}

	/** @deprecated */
	chain<K extends keyof GetEvents<this>>(
		name: K,
		...args: Parameters<GetEvents<this>[K]>
	): ReturnType<GetEvents<this>[K]>;
	chain<K extends keyof GetEvents<this>>(
		thisArg: ThisType<GetEvents<this>[K]>,
		name: K,
		...args: Parameters<GetEvents<this>[K]>
	): ReturnType<GetEvents<this>[K]>;
	chain(...args: [any, ...any[]]) {
		return chainImpl(this, args);
	}

	before<K extends BeforeEventName>(
		name: K,
		listener: BeforeEventMap[K],
		append = false,
	) {
		const seg = (name as string).split("/");
		seg[seg.length - 1] = "before-" + seg[seg.length - 1];
		return this.on(seg.join("/") as any, listener, !append);
	}
}

export * from "./runtime";
export { default } from "./runtime";

export namespace Context {
	export interface Config extends Config.Basic, Config.Advanced {
		i18n?: I18n.Config;
		delay?: Config.Delay;
		request?: HTTP.Config;
	}

	export namespace Config {
		export interface Basic extends Commander.Config {
			nickname?: string | string[];
			autoAssign?: Computed<boolean>;
			autoAuthorize?: Computed<number>;
			minSimilarity?: number;
		}

		export interface Delay {
			character?: number;
			message?: number;
			cancel?: number;
			broadcast?: number;
			prompt?: number;
		}

		export interface Advanced {
			maxListeners?: number;
		}

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

// for backward compatibility
export { Context as App };
