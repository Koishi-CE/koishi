// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * Commander：命令服务对外类（ctx.$commander 的实例类型）。
 *
 * 继承链 CommanderCore → CommanderResolve → CommanderRegister → Commander，
 * 构造时由 setupCommander 完成事件监听、schema 扩展与内置 domain 注册，
 * 之后由 core 实例化并挂到 Context 上。
 */

import type { Context } from "../../context/index.ts";
import type { CommanderConfig } from "./core.ts";
import { CommanderRegister } from "./register.ts";
import { setupCommander } from "./setup.ts";

export class Commander extends CommanderRegister {
	constructor(ctx: Context, config: Commander.Config = {}) {
		super();
		this.ctx = ctx;
		this.config = config;
		setupCommander(this, ctx);
	}
}

export namespace Commander {
	/** 命令服务配置（App 层传入） */
	export interface Config extends CommanderConfig {}
}
