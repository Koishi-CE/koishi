// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 内置数据服务：权限列表提供者。
 *
 * 将当前应用全部可分配权限下发给控制台前端（供权限管理界面使用），
 * 并监听 internal/permission 事件在权限定义变动时自动刷新。
 */

import type { Context } from "@koishi-ce/koishi";
import { DataService } from "./service.ts";

export class PermissionProvider extends DataService<
	string[]
> {
	constructor(ctx: Context) {
		super(ctx, "permissions", { immediate: true });

		// 权限定义发生增删时重新下发全量权限列表
		ctx.on("internal/permission", () => this.refresh());
	}

	override async get() {
		return this.ctx.permissions.list();
	}
}
