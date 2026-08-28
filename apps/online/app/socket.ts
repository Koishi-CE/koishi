/**
 * 进程内成对的 WebSocket：为控制台前端提供与真实后端一致的通信通道。
 *
 * 浏览器侧的 ClientWebSocket 与 Koishi 侧的 ServerWebSocket 互为
 * remote，send() 直接在对端派发 message 事件——消息全程不出浏览器。
 * ServerWebSocket 构造时还会把自身挂到 loader 的 koishi.socket 符号键
 * 上并触发 utils.ts 的初始化，从而启动浏览器内的 Koishi 实例。
 */
import type { Dict } from "@koishi-ce/client";
import type { Context, Universal } from "@koishi-ce/koishi";
import loader from "./loader";
import { initialize } from "./utils";

/** WebSocket 事件模型的最小实现（事件类型与监听器均宽松处理）。 */
class StubWebSocket implements Universal.WebSocket {
	url = "";
	// 两个派生类（ServerWebSocket / ClientWebSocket）的构造流程均保证赋值
	remote!: StubWebSocket;
	listeners: Dict<Set<Universal.WebSocket.EventListener>> = {};

	addEventListener(type: any, listener: (event: any) => void) {
		if (!this.listeners[type]) this.listeners[type] = new Set();
		this.listeners[type].add(listener);
	}

	removeEventListener(type: any, listener: (event: any) => void) {
		this.listeners[type]?.delete(listener);
	}

	dispatchEvent(event: any) {
		this.listeners[event.type]?.forEach((fn) => {
			fn(event);
		});
		return true;
	}

	/** 把消息直通给对端：以 message 事件派发，target 指向发送方自身。 */
	send(data: string) {
		this.remote.dispatchEvent({ type: "message", target: this, data });
	}

	// 进程内通道无需真正关闭
	close() {}
}

/**
 * Koishi 侧的"服务端"套接字：构造即启动浏览器内的运行时——先把自身
 * 挂到 loader 的 koishi.socket 符号键上（控制台的数据通道），再执行
 * utils.ts 的初始化流程（装载实例并启动 Koishi 应用）。
 */
class ServerWebSocket extends StubWebSocket {
	// 由 loader 机制在建立连接后回填
	app!: Context;

	constructor(remote: StubWebSocket) {
		super();
		this.remote = remote;
		void this.start();
	}

	private async start() {
		loader[Symbol.for("koishi.socket")] = this;
		await initialize();
	}
}

/**
 * 浏览器侧的"客户端"套接字：构造时立即配对出 ServerWebSocket（后者随
 * 之启动 Koishi 运行时），并把 open 事件推迟到下一个宏任务派发，给
 * 调用方留出注册监听器的时间。由 app/index.ts 在建立连接时传入
 * connect() 使用。
 */
export default class ClientWebSocket extends StubWebSocket {
	remote = new ServerWebSocket(this);

	constructor() {
		super();
		setTimeout(() => this.dispatchEvent({ type: "open", target: this }), 0);
	}
}
