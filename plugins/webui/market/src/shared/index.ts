import { DataService } from "@koishi-ce/console";
import {
	type Awaitable,
	type Context,
	type Dict,
	Logger,
	Time,
} from "@koishi-ce/koishi";
import type { SearchObject, SearchResult } from "@koishi-ce/registry";

declare module "@koishi-ce/console" {
	interface Events {
		"market/refresh"(): void;
	}

	namespace Console {
		interface Services {
			market: MarketProvider;
		}
	}
}

const logger = new Logger("market");

export abstract class MarketProvider extends DataService<MarketProvider.Payload> {
	private _task: Promise<SearchResult | undefined> | null = null;
	private _timestamp = 0;
	protected _error: unknown;

	constructor(ctx: Context) {
		super(ctx, "market", { authority: 4 });

		ctx.console.addListener("market/refresh", () => this.start(true), {
			authority: 4,
		});

		ctx.on("console/connection", async (client) => {
			if (!ctx.console.clients[client.id]) return;
			if (Date.now() - this._timestamp <= Time.hour * 12) return;
			if (await this.ctx.serial("console/intercept", client, { authority: 4 }))
				return;
			this.start();
		});
	}

	override start(_refresh = false): Awaitable<void> {
		this._task = null;
		this._error = null;
		this._timestamp = Date.now();
		this.refresh();
	}

	abstract collect(): Promise<SearchResult | undefined>;

	async prepare(): Promise<SearchResult | undefined> {
		return (this._task ||= this.collect().catch((error: unknown) => {
			logger.warn(error);
			this._error = error;
			return undefined;
		}));
	}
}

export namespace MarketProvider {
	export interface Payload {
		registry?: string | undefined;
		data: Dict<SearchObject>;
		total: number;
		failed: number;
		progress: number;
		gravatar?: string | undefined;
	}
}
