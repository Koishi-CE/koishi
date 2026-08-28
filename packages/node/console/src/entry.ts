import type { Context } from "@koishi-ce/koishi";
import type { Client } from ".";

export namespace Entry {
	export type Files = string | string[] | EntryOptions;

	export interface EntryOptions {
		dev: string;
		prod: string | string[];
	}
}

export class Entry<T = unknown> {
	public id = Math.random().toString(36).slice(2);
	public dispose: () => void;

	public ctx: Context;
	public files: Entry.Files;
	public data: ((client: Client) => T) | undefined;

	constructor(ctx: Context, files: Entry.Files, data?: (client: Client) => T) {
		this.ctx = ctx;
		this.files = files;
		this.data = data;
		ctx.console.entries[this.id] = this;
		ctx.console.refresh("entry");
		this.dispose = ctx.effect(() => {
			return () => {
				delete this.ctx.console.entries[this.id];
				ctx.console.refresh("entry");
			};
		});
	}

	refresh() {
		this.ctx.console.broadcast("entry-data", async (client: Client) => ({
			id: this.id,
			data: await this.data?.(client),
		}));
	}
}
