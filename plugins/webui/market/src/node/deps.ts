// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { DataService } from "@koishi-ce/console";
import type { Context, Dict } from "@koishi-ce/koishi";
import type {
	DependencyMetaKey,
	RemotePackage,
} from "@koishi-ce/registry";

class RegistryProvider extends DataService<
	Dict<Dict<Pick<RemotePackage, DependencyMetaKey>>>
> {
	constructor(ctx: Context) {
		super(ctx, "registry", { authority: 4 });
	}

	override async get() {
		return this.ctx.installer.fullCache;
	}
}

export { RegistryProvider };
