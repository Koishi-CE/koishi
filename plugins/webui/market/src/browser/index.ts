// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { type Context, Schema } from "@koishi-ce/koishi";
import MarketProvider from "./market.ts";

export * from "../shared/index.ts";
export * from "./market.ts";

export { MarketProvider };

export const filter = false;
export const name = "market";
export const inject = ["console"];

export type Config = Record<never, never>;

export const Config: Schema<Config> = Schema.object({});

export function apply(ctx: Context, _config: Config) {
	ctx.plugin(MarketProvider);

	const base = process.env["KOISHI_BASE"];
	ctx.console.addEntry(
		base
			? [`${base}/dist/index.js`, `${base}/dist/style.css`]
			: [import.meta.url.replace(/\/src\/[^/]+\/[^/]+$/, "/client/index.ts")],
	);
}
