import { DataService } from "@koishi-ce/console";
import type { Context } from "@koishi-ce/koishi";
import type {
	MarketLookupRequest,
	MarketLookupResult,
	MarketPayload,
	MarketSnapshotRequest,
	MarketSnapshotResponse,
} from "./types.js";

declare module "@koishi-ce/console" {
	interface Events {
		"market/refresh"(): Promise<void>;
		"market/refresh-dependencies"(): Promise<void>;
		"market/index"(
			request?: MarketSnapshotRequest,
		): Promise<MarketSnapshotResponse>;
		"market/lookup"(request: MarketLookupRequest): Promise<MarketLookupResult>;
	}

	namespace Console {
		interface Services {
			market: MarketProvider;
		}
	}
}

/** 市场 DataService 适配基类；具体刷新状态由实现自己的运行时管理。 */
export abstract class MarketProvider extends DataService<MarketPayload> {
	constructor(ctx: Context) {
		super(ctx, "market", { authority: 4 });

		ctx.console.addListener(
			"market/refresh",
			async () => {
				await this.start(true);
			},
			{ authority: 4 },
		);
	}

	abstract override start(refresh?: boolean): Promise<void>;
	abstract getSnapshot(): Promise<MarketPayload>;
	probeInBackground?(reason?: string): Promise<boolean>;
}

export namespace MarketProvider {
	export type Payload = MarketPayload;
}
