// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import * as shared from "../shared/index.ts";

export class PackageProvider extends shared.PackageProvider {
	async collect(_forced: boolean) {
		return this.ctx.loader.market.objects;
	}
}
