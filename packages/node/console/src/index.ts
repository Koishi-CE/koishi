import {
	type Awaitable,
	type Context,
	type Dict,
	Service,
	type Universal,
	valueMap,
} from "@koishi-ce/koishi";
import type { IncomingMessage } from "http";
import { Client } from "./client";
import { Entry } from "./entry";
import { PermissionProvider } from "./permission";
import { SchemaProvider } from "./schema";
import { DataService } from "./service";

export * from "./client";
export * from "./entry";
export * from "./service";

declare module "@koishi-ce/koishi" {
	interface Context {
		console: Console;
	}

	interface Events {
		"console/connection"(client: Client): void;
		"console/intercept"(
			client: Client,
			listener: DataService.Options,
		): Awaitable<boolean>;
	}
}

export interface Listener extends DataService.Options {
	callback(this: Client, ...args: any[]): Awaitable<any>;
}

export interface EntryData {
	files: string[];
	paths?: string[];
	data: () => any;
}

export class EntryProvider extends DataService<Dict<EntryData>> {
	static override inject = [];

	constructor(ctx: Context) {
		super(ctx, "entry", { immediate: true });
	}

	override async get(_forced: boolean, client: Client) {
		return this.ctx.console.get(client);
	}
}

export abstract class Console extends Service {
	static filter = false;
	static inject = { optional: ["console"] };

	private id = Math.random().toString(36).slice(2);

	readonly entries: Dict<Entry> = Object.create(null);
	readonly listeners: Dict<Listener> = Object.create(null);
	readonly clients: Dict<Client> = Object.create(null);

	public services = new Proxy({} as Console.Services, {
		get: (target, key, receiver) => {
			if (typeof key === "symbol") return Reflect.get(target, key, receiver);
			return this.ctx.get(`console.services.${key}`);
		},
		set: (_target, _key, _value, _receiver) => {
			return false;
		},
	});

	public override ctx: Context;

	constructor(ctx: Context) {
		super(ctx, "console", true);
		this.ctx = ctx;
		ctx.plugin(EntryProvider);
		ctx.plugin(SchemaProvider);
		ctx.plugin(PermissionProvider);
		this.addListener("ping", () => "pong");
	}

	protected accept(socket: Universal.WebSocket, request?: IncomingMessage) {
		const client = new Client(this.ctx, socket, request);
		socket.addEventListener("close", () => {
			delete this.clients[client.id];
			this.ctx.emit("console/connection", client);
		});
		this.clients[client.id] = client;
		this.ctx.emit("console/connection", client);
	}

	async get(client: Client) {
		const result = valueMap(this.entries, ({ files, ctx, data }, key) => {
			const paths = this.ctx.get("loader")?.paths(ctx.scope);
			return {
				files: this.resolveEntry(files, key),
				...(paths !== undefined ? { paths } : {}),
				data: data?.(client),
			};
		});
		result["_id"] = this.id as any;
		return result;
	}

	protected abstract resolveEntry(files: Entry.Files, key: string): string[];

	addEntry<T>(files: Entry.Files, data?: () => T) {
		return new Entry(this.ctx, files, data);
	}

	addListener<K extends keyof Events>(
		event: K,
		callback: Events[K],
		options?: DataService.Options,
	) {
		this.listeners[event] = { callback, ...options };
	}

	async broadcast(type: string, body: any, options: DataService.Options = {}) {
		const handles = Object.values(this.clients);
		if (!handles.length) return;
		await Promise.all(
			Object.values(this.clients).map(async (client) => {
				if (await this.ctx.serial("console/intercept", client, options)) return;
				const data = { type, body };
				if (typeof body === "function") data.body = await body(client);
				client.socket.send(JSON.stringify(data));
			}),
		);
	}

	refresh<K extends keyof Console.Services>(type: K) {
		return this.ctx.get(`console.services.${type}`)?.refresh();
	}

	patch<K extends keyof Console.Services>(
		type: K,
		value: Console.Services[K] extends DataService<infer T> ? T : never,
	) {
		return this.ctx.get(`console.services.${type}`)?.patch(value as any);
	}
}

export interface Events {
	ping(): string;
}

export namespace Console {
	export interface Services {
		entry: EntryProvider;
		schema: SchemaProvider;
		permissions: PermissionProvider;
	}
}

export default Console;
