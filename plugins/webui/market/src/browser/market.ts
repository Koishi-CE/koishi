// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import type {} from "@koishi-ce/plugin-config";
import { MarketProvider as BaseMarketProvider } from "../shared/index.ts";

export default class MarketProvider extends BaseMarketProvider {
	async collect() {
		return this.ctx.loader.market;
	}

	override async get() {
		const market = await this.prepare();
		if (!market)
			return { data: {}, failed: 0, total: 0, progress: 0 };
		return {
			data: Object.fromEntries(
				market.objects.map((item) => [
					item.package.name,
					item,
				]),
			),
			failed: 0,
			total: market.objects.length,
			progress: market.objects.length,
		};
	}
}
