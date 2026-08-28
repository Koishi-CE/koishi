import type { Dict } from "@koishi-ce/client";
import type { Context, Universal } from "@koishi-ce/koishi";
import loader from "./loader";
import { initialize } from "./utils";

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

	send(data: string) {
		this.remote.dispatchEvent({ type: "message", target: this, data });
	}

	close() {}
}

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

export default class ClientWebSocket extends StubWebSocket {
	remote = new ServerWebSocket(this);

	constructor() {
		super();
		setTimeout(() => this.dispatchEvent({ type: "open", target: this }), 0);
	}
}
