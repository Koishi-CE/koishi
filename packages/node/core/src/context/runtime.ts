import * as satori from "@satorijs/core";
import * as cordis from "cordis";
import BotMixin from "../bot";
import DatabaseMixin from "../database";
import SessionMixin from "../session";
import { Context } from "./index";

export default class Koishi extends cordis.Service<Context.Config, Context> {
	override config: Context.Config;

	bot = new BotMixin(this.ctx);
	database = new DatabaseMixin(this.ctx);
	session = new SessionMixin(this.ctx);

	constructor(ctx: Context, config: Context.Config) {
		super(ctx, "koishi", true);
		this.config = config;
	}
}

export abstract class Service<
	T = any,
	C extends Context = Context,
> extends satori.Service<T, C> {
	override [satori.Service.setup]() {
		this.ctx = new Context() as C;
	}
}

export function defineConfig(config: Context.Config) {
	return config;
}
