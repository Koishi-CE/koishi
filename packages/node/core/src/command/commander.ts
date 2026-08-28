import type { Context } from "../context";
import type { CommanderConfig } from "./commander-core";
import { CommanderRegister } from "./commander-register";
import { setupCommander } from "./commander-setup";

export class Commander extends CommanderRegister {
	constructor(ctx: Context, config: Commander.Config = {}) {
		super();
		this.ctx = ctx;
		this.config = config;
		setupCommander(this, ctx);
	}
}

export namespace Commander {
	export interface Config extends CommanderConfig {}
}
