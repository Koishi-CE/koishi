/**
 * 控制台客户端：服务端对一个浏览器 WebSocket 连接的封装。
 *
 * 职责：接收并分发前端 RPC 请求（请求-响应模式，带 id 关联），
 * 以及在连接建立时拉取全部数据服务的当前值推送给前端（完成首屏数据同步）。
 */

import type { IncomingMessage } from "node:http";
import {
	Context,
	coerce,
	Logger,
	Random,
	type Universal,
} from "@koishi-ce/koishi";
import type { DataService } from "./service.ts";

const logger = new Logger("console");

export class Client {
	/** 客户端随机标识 */
	readonly id: string = Random.id();

	readonly ctx: Context;
	/** 底层 WebSocket 连接 */
	public socket: Universal.WebSocket;
	/** WebSocket 升级请求（握手期的 HTTP 请求对象，可取头信息与来源地址） */
	public request: IncomingMessage;

	constructor(
		ctx: Context,
		socket: Universal.WebSocket,
		request: IncomingMessage,
	) {
		this.ctx = ctx;
		this.socket = socket;
		this.request = request;
		socket.addEventListener("message", this.receive);
		// 宿主上下文销毁时同步解绑消息监听，避免向已关闭的套接字投递
		ctx.on("dispose", () => {
			socket.removeEventListener("message", this.receive);
		});
		this.refresh();
	}

	/**
	 * 向客户端发送一条 JSON 消息。
	 *
	 * @param payload 任意可序列化对象
	 */
	send(payload: unknown) {
		this.socket.send(JSON.stringify(payload));
	}

	/**
	 * WebSocket 消息处理器：解析前端 RPC 请求并分发到对应监听器。
	 *
	 * 处理流程：查找监听器 → 拦截器事件鉴权（被拦截则回 unauthorized）→
	 * 执行回调并按请求 id 回传结果或错误文本（coerce 格式化的堆栈）。
	 */
	receive = async (data: Universal.WebSocket.MessageEvent) => {
		const { type, args, id } = JSON.parse(data.data.toString());
		const listener = this.ctx.console.listeners[type];
		if (!listener) {
			logger.info("unknown message:", type, ...args);
			return this.send({
				type: "response",
				body: { id, error: "not implemented" },
			});
		}

		if (await this.ctx.serial("console/intercept", this, listener)) {
			return this.send({
				type: "response",
				body: { id, error: "unauthorized" },
			});
		}

		try {
			const value = await listener.callback.call(this, ...args);
			return this.send({ type: "response", body: { id, value } });
		} catch (e) {
			logger.debug(e);
			const error = coerce(e);
			return this.send({ type: "response", body: { id, error } });
		}
	};

	/**
	 * 遍历所有已注册的数据服务（console.services.*），
	 * 将各自当前数据全量推送给本客户端。用于连接建立后的首屏同步；
	 * 被拦截器拦下的服务会下发 null（前端据此清空对应数据）。
	 */
	refresh() {
		Object.keys(this.ctx.root[Context.internal]).forEach(async (name) => {
			if (!name.startsWith("console.services.")) return;
			// "console.services.".length === 17
			const key = name.slice(17);
			const service = this.ctx.get(name) as DataService;
			if (!service) return;
			if (await this.ctx.serial("console/intercept", this, service.options)) {
				return this.send({ type: "data", body: { key, value: null } });
			}

			try {
				const value = await service.get(false, this);
				if (!value) return;
				this.send({ type: "data", body: { key, value } });
			} catch (error) {
				logger.warn(error);
			}
		});
	}
}
