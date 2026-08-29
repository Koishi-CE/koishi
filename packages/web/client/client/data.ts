/// <reference path="./shims.d.ts" />
import type { Promisify, Universal } from "@koishi-ce/koishi";
import type {
	ClientConfig,
	Console,
	DataService,
	Events,
} from "@koishi-ce/plugin-console";
import { markRaw, reactive, ref } from "vue";
import type { Context } from "./context";

/**
 * 全局数据仓库的类型：按服务名映射到该 DataService 推送的负载数据。
 * 服务端每类数据（entry、schema、permissions 等）对应 Store 的一个键。
 */
export type Store = {
	[K in keyof Console.Services]?: Console.Services[K] extends DataService<
		infer T
	>
		? T
		: never;
};

// 由构建期注入的客户端配置（见 @koishi-ce/plugin-console 的 define 替换）
declare const KOISHI_CONFIG: ClientConfig;
/** 服务端下发的客户端配置（uiPath、heartbeat、proxyBase 等），只读 */
export const global = KOISHI_CONFIG;
/** 全局响应式数据仓库：服务端通过 data/patch 事件驱动其更新 */
export const store = reactive<Store>({});

/**
 * 为资源 URL 拼上代理前缀。
 * 控制台在反向代理后部署时，静态资源需经由 proxyBase 转发。
 */
export function withProxy(url: string) {
	return (global.proxyBase || "") + url;
}

/** 当前与服务端的 WebSocket 连接（未连接时为 null） */
export const socket = ref<Universal.WebSocket | null>(null);
/** 按事件名登记的推送监听器（receive 注册） */
const listeners: Record<string, (data: unknown) => void> = {};
/** 按报文 id 暂存的 RPC 应答钩子 [resolve, reject]（send 写入） */
const responseHooks: Record<
	string,
	[(value: unknown) => void, (reason?: unknown) => void]
> = {};

/**
 * 向服务端发起一次 RPC 调用。
 *
 * 通过 WebSocket 发送 `{ id, type, args }` 报文，并以随机 id 关联
 * 异步应答（见下方 "response" 监听）；超时 60s 后 reject。
 * @param type 事件名（对应服务端 Events 接口的方法名）
 * @param args 调用参数
 */
export function send<T extends keyof Events>(
	type: T,
	...args: Parameters<Events[T]>
): Promisify<ReturnType<Events[T]>>;
export function send(type: string, ...args: unknown[]) {
	if (!socket.value) return;
	console.debug("↑%c", "color:brown", type, args);
	const id = Math.random().toString(36).slice(2, 9);
	socket.value.send(JSON.stringify({ id, type, args }));
	return new Promise((resolve, reject) => {
		responseHooks[id] = [resolve, reject];
		setTimeout(() => {
			delete responseHooks[id];
			reject(new Error("timeout"));
		}, 60000);
	});
}

/**
 * 注册服务端主动推送事件的监听器（每类事件仅保留最后一个监听）。
 * @param event 事件名，如 "data" / "patch" / "response" / "entry-data"
 */
export function receive<T = unknown>(
	event: string,
	listener: (data: T) => void,
) {
	// 注册表按 unknown 分发实际报文，监听器的载荷类型由调用方以泛型参数自行声明
	listeners[event] = listener as (data: unknown) => void;
}

/** Store 各键负载数据的联合（服务端推送的合法取值集合） */
type StoreValue = Store[keyof Store];

// 服务端整表推送：直接覆盖 store 中对应键
// （key 为联合类型时直写 store[key] 会被要求交叉类型，故经 Record 视图写入）
receive<{ key: keyof Store; value: unknown }>("data", ({ key, value }) => {
	(store as Record<keyof Store, StoreValue>)[key] = value as StoreValue;
});

// 服务端增量推送：数组做追加，对象做浅合并
receive<{ key: keyof Store; value: unknown }>("patch", ({ key, value }) => {
	const current = store[key];
	if (Array.isArray(current)) {
		(current as unknown[]).push(...(value as unknown[]));
	} else if (current) {
		Object.assign(current, value);
	}
});

// RPC 应答分发：按报文 id 找到 send() 留下的 resolve/reject 并结算
receive<{ id: string; value?: unknown; error?: unknown }>(
	"response",
	({ id, value, error }) => {
		const hooks = responseHooks[id];
		if (!hooks) return;
		delete responseHooks[id];
		const [resolve, reject] = hooks;
		if (error) {
			reject(error);
		} else {
			resolve(value);
		}
	},
);

/**
 * 建立 WebSocket 连接并维护其生命周期。
 *
 * - 开启心跳：按配置间隔发送 ping，超时未收到消息则主动断开；
 * - 断线重连：清空 store 后 1s 重试，重连成功则刷新页面以恢复完整状态。
 * @param ctx 根 Context，用于把消息转发为 cordis 事件
 * @param callback 创建 WebSocket 实例的工厂函数
 */
export function connect(ctx: Context, callback: () => Universal.WebSocket) {
	const value = callback();

	let sendTimer: number;
	let closeTimer: number;
	// 每收到一条消息就重置两个计时器：interval 到点发 ping，
	// timeout 到点仍无消息则强制断线（触发 reconnect）
	const refresh = () => {
		if (!global.heartbeat) return;
		clearTimeout(sendTimer);
		clearTimeout(closeTimer);
		sendTimer = +setTimeout(() => send("ping"), global.heartbeat.interval);
		closeTimer = +setTimeout(() => value?.close(), global.heartbeat.timeout);
	};

	const reconnect = () => {
		socket.value = null;
		// 清空本地数据仓库：断线期间的数据已不可信，等待重连后重新拉取
		for (const key in store) {
			(store as Record<string, unknown>)[key] = undefined;
		}
		console.log("[koishi] websocket disconnected, will retry in 1s...");
		setTimeout(() => {
			connect(ctx, callback).then(location.reload, () => {
				console.log("[koishi] websocket disconnected, will retry in 1s...");
			});
		}, 1000);
	};

	value.addEventListener("message", (ev) => {
		refresh();
		const data = JSON.parse(ev.data);
		console.debug("↓%c", "color:purple", data.type, data.body);
		if (data.type in listeners) {
			listeners[data.type]?.(data.body);
		}
		ctx.emit(data.type, data.body);
	});

	value.addEventListener("close", reconnect);

	return new Promise<Universal.WebSocket.Event>((resolve, reject) => {
		value.addEventListener("open", (event) => {
			socket.value = markRaw(value);
			resolve(event);
		});
		value.addEventListener("error", reject);
	});
}
