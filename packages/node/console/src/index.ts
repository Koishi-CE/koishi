/**
 * 控制台服务端核心：Console 抽象服务。
 *
 * Console 是控制台体系的服务端基座，管理三类对象：
 * - clients：已连接的 WebSocket 客户端（Client）；
 * - entries：前端入口（Entry），决定浏览器要加载哪些扩展脚本；
 * - listeners：可被前端 RPC 调用的监听器。
 *
 * 数据面由各 DataService（以 `console.services.*` 为服务名注册）承载，
 * 本文件同时内置 entry / schema / permissions 三个内置数据服务。
 * WebSocket 的实际接入（HTTP 升级、鉴权等）由派生类实现。
 */

import {
	type Awaitable,
	type Context,
	type Dict,
	Service,
	type Universal,
	valueMap,
} from "@koishi-ce/koishi";
import { Client } from "./client";
import { Entry } from "./entry";
import { PermissionProvider } from "./permission";
import { SchemaProvider } from "./schema";
import { DataService } from "./service";

export * from "./client";
export * from "./entry";
export * from "./service";

// 通过模块合并向全局类型注入 console 服务与相关事件
declare module "@koishi-ce/koishi" {
	interface Context {
		/** 控制台服务实例 */
		console: Console;
	}

	interface Events {
		/** 有客户端建立或断开连接时触发 */
		"console/connection"(client: Client): void;
		/**
		 * 拦截器事件：串行执行，任一监听器返回 true 即拦截
		 * 该客户端对指定监听器/数据服务的访问
		 */
		"console/intercept"(
			client: Client,
			listener: DataService.Options,
		): Awaitable<boolean>;
	}
}

/** 前端 RPC 监听器：回调绑定到发起调用的 Client 上执行 */
export interface Listener extends DataService.Options {
	callback(this: Client, ...args: unknown[]): Awaitable<unknown>;
}

/** 单个入口下发给前端的数据结构 */
export interface EntryData {
	/** 前端需要加载的脚本文件列表 */
	files: string[];
	/** 入口对应的插件路径（如 ["group:entry", "group:manager", "plugins"]） */
	paths?: string[];
	/** 下发给客户端的初始数据 */
	data: unknown;
}

interface EntryResponseData {
	files: string[];
	paths?: string[];
	data: unknown;
}

type EntryResponse = Record<string, EntryResponseData | string>;
type ServiceValue<K extends keyof Console.Services> =
	Console.Services[K] extends DataService<infer T> ? T : never;

/**
 * 内置数据服务：向前端下发全部入口信息。
 * 前端据此得知要加载的扩展脚本、各入口的插件路径与初始数据。
 */
export class EntryProvider extends DataService<EntryResponse> {
	static override inject = [];

	constructor(ctx: Context) {
		super(ctx, "entry", { immediate: true });
	}

	override async get(_forced: boolean, client: Client) {
		return this.ctx.console.get(client);
	}
}

/**
 * 控制台服务抽象基类。
 *
 * 派生类需实现 accept() 以接收 WebSocket 连接与 resolveEntry() 以将入口
 * 文件声明解析为实际 URL。本类负责客户端/入口/监听器的登记、广播与数据服务的代理访问。
 */
export abstract class Console extends Service {
	static filter = false;
	static inject = { optional: ["console"] };

	/** 本服务实例的随机标识，随入口数据下发，用于前端识别服务重启 */
	private id = Math.random().toString(36).slice(2);

	/** 已注册的前端入口表，键为入口随机 id */
	readonly entries: Dict<Entry> = Object.create(null);
	/** 前端 RPC 监听器表，键为事件名 */
	readonly listeners: Dict<Listener> = Object.create(null);
	/** 在线客户端表，键为客户端 id */
	readonly clients: Dict<Client> = Object.create(null);

	/**
	 * 数据服务代理：按名称从容器中惰性解析 `console.services.*`，
	 * 使插件可在其注册前引用（并保持类型提示）。只读，禁止直接赋值。
	 */
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
		// 注册三个内置数据服务
		ctx.plugin(EntryProvider);
		ctx.plugin(SchemaProvider);
		ctx.plugin(PermissionProvider);
		// 内置 ping 监听器，供前端探活
		this.addListener("ping", () => "pong");
	}

	/**
	 * 接收一个已建立的 WebSocket 连接。
	 * 由派生类在握手完成时调用；此处登记客户端并在连接关闭时清理。
	 */
	protected accept(socket: Universal.WebSocket) {
		const client = new Client(this.ctx, socket);
		socket.addEventListener("close", () => {
			delete this.clients[client.id];
			this.ctx.emit("console/connection", client);
		});
		this.clients[client.id] = client;
		this.ctx.emit("console/connection", client);
	}

	/**
	 * 汇总所有入口的下发数据（供 EntryProvider 使用）。
	 *
	 * @param client 发起请求的客户端，初始数据可按客户端定制
	 * @returns 以入口 id 为键的响应表，并附带本服务的 `_id`
	 */
	async get(client: Client) {
		return {
			...valueMap(this.entries, ({ files, ctx, data }, key) => {
				const paths = this.ctx.get("loader")?.paths(ctx.scope);
				return {
					files: this.resolveEntry(files, key),
					...(paths !== undefined ? { paths } : {}),
					data: data?.(client),
				};
			}),
			_id: this.id,
		};
	}

	/**
	 * 将入口的文件声明解析为前端可加载的 URL 列表。
	 * 由具体宿主环境（如 @koishi-ce/plugin-console）实现。
	 */
	protected abstract resolveEntry(files: Entry.Files, key: string): string[];

	/**
	 * 注册一个前端入口（扩展脚本）。
	 *
	 * @param files 文件声明：字符串、字符串数组或区分 dev/prod 的选项对象
	 * @param data 可选的初始数据工厂，按客户端惰性求值
	 * @returns 入口实例，销毁其上下文即自动注销
	 */
	addEntry<T>(files: Entry.Files, data?: () => T) {
		return new Entry(this.ctx, files, data);
	}

	/**
	 * 注册一个供前端 RPC 调用的监听器。
	 *
	 * @param event 事件名（同时也是前端调用的 type）
	 * @param callback 处理回调，this 绑定为发起调用的客户端
	 * @param options 附加选项（如 authority 权限门槛）
	 */
	addListener<K extends keyof Events>(
		event: K,
		callback: Events[K],
		options?: DataService.Options,
	) {
		this.listeners[event] = { callback, ...options };
	}

	/**
	 * 向所有在线客户端广播消息。
	 *
	 * @param type 消息类型
	 * @param body 消息体；传函数则按客户端分别求值（用于差异化下发）
	 * @param options 参与拦截判断的选项
	 *
	 * 每个客户端都会先经过 console/intercept 事件过滤，被拦截者不发送。
	 */
	async broadcast(
		type: string,
		body: unknown,
		options: DataService.Options = {},
	) {
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

	/**
	 * 触发指定数据服务的全量刷新（重新计算并广播数据）。
	 */
	refresh<K extends keyof Console.Services>(type: K) {
		return this.ctx.get(`console.services.${type}`)?.refresh();
	}

	/**
	 * 向指定数据服务提交增量补丁（部分更新）并广播。
	 */
	patch<K extends keyof Console.Services>(type: K, value: ServiceValue<K>) {
		const service = this.ctx.get(`console.services.${type}`) as
			| { patch(value: ServiceValue<K>): void }
			| undefined;
		return service?.patch(value);
	}
}

/** 内置事件（可被前端 RPC 调用） */
export interface Events {
	ping(): string;
}

export namespace Console {
	/** 内置数据服务清单，插件可通过模块合并扩展此接口 */
	export interface Services {
		entry: EntryProvider;
		schema: SchemaProvider;
		permissions: PermissionProvider;
	}
}

export default Console;
