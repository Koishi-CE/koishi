import { type Context, Service } from "@koishi-ce/koishi";
import type Console from ".";
import type { Client } from ".";

export namespace DataService {
	export interface Options {
		immediate?: boolean;
		authority?: number;
	}
}

export abstract class DataService<T = never> extends Service {
	static filter = false;
	static inject = ["console"];

	public async get(_forced?: boolean, _client?: Client): Promise<T> {
		return null as T;
	}

	protected override ctx: Context;
	protected key: keyof Console.Services;
	public options: DataService.Options = {};

	constructor(
		ctx: Context,
		key: keyof Console.Services,
		options: DataService.Options = {},
	) {
		super(ctx, `console.services.${key}`, options.immediate);
		this.ctx = ctx;
		this.key = key;
		this.options = options;
	}

	override start() {
		this.refresh();
	}

	async refresh(forced = true) {
		this.ctx.get("console")?.broadcast(
			"data",
			async (client: Client) => ({
				key: this.key,
				value: await this.get(forced, client),
			}),
			this.options,
		);
	}

	patch(value: T) {
		this.ctx.get("console")?.broadcast(
			"patch",
			{
				key: this.key,
				value,
			},
			this.options,
		);
	}
}
