/**
 * mock Webhook：不经过真实网络的 HTTP 请求模拟器。
 *
 * 手工构造 IncomingMessage / ServerResponse，直接向
 * @koishi-ce/plugin-server 的底层 HTTP 服务派发 request 事件，
 * 提供 head / get / delete / post / put / patch 等方法，
 * 供服务类插件的测试发起请求并取回响应。
 */

import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import type { Context, Dict } from "@koishi-ce/koishi";
// 仅为引入 plugin-server 的模块增强，使下方 ctx.server 的类型可用
import type {} from "@koishi-ce/plugin-server";

export namespace Webhook {
	/** 模拟响应：状态码、响应体与响应头 */
	export interface Response {
		code: number;
		body: string;
		/** 响应头（值的运行时形态由 HTTP 层决定，此处不约束） */
		headers: Dict<unknown>;
	}
}

/** 直接驱动 plugin-server HTTP 栈的测试客户端（注入 server 服务） */
export class Webhook {
	static inject = ["server"];

	// erasableSyntaxOnly 禁止构造器参数属性，改为显式字段声明 + 赋值
	public ctx: Context;

	constructor(ctx: Context) {
		this.ctx = ctx;
	}

	/** 发送 HEAD 请求，返回响应头 */
	async head(path: string, headers?: Dict<unknown>) {
		const res = await this.receive("HEAD", path, headers, "");
		return res.headers;
	}

	/** 发送 GET 请求 */
	async get(path: string, headers?: Dict<unknown>) {
		return this.receive("GET", path, headers, "");
	}

	/** 发送 DELETE 请求 */
	async delete(path: string, headers?: Dict<unknown>) {
		return this.receive("DELETE", path, headers, "");
	}

	/** 发送 POST 请求（body 为字符串 / Buffer 时按原类型发送，其余序列化为 JSON） */
	async post(path: string, body: unknown, headers?: Dict<unknown>) {
		return this.receive("POST", path, headers, body);
	}

	/** 发送 PUT 请求（body 为字符串 / Buffer 时按原类型发送，其余序列化为 JSON） */
	async put(path: string, body: unknown, headers?: Dict<unknown>) {
		return this.receive("PUT", path, headers, body);
	}

	/** 发送 PATCH 请求（body 为字符串 / Buffer 时按原类型发送，其余序列化为 JSON） */
	async patch(path: string, body: unknown, headers?: Dict<unknown>) {
		return this.receive("PATCH", path, headers, body);
	}

	// headers 可选传入，未传（undefined）时由默认值兜底，行为与原先一致
	/**
	 * 构造原生 req / res 对象并直接派发到 HTTP 服务
	 * @param method HTTP 方法
	 * @param path 请求路径
	 * @param headers 请求头（未传时为空对象，行为与原先一致）
	 * @param body 请求体（字符串 / Buffer 按原类型发送，其余序列化为 JSON）
	 */
	receive(
		method: string,
		path: string,
		headers: Dict<unknown> = {},
		body: unknown,
	) {
		const socket = new Socket();
		const req = new IncomingMessage(socket);
		req.url = path;
		req.method = method;

		// 构造请求头（按请求体类型补全 content-type）；payload 为统一后的待发送形态
		Object.assign(req.headers, headers);
		let payload: string | Buffer;
		if (typeof body === "string") {
			payload = body;
			req.headers["content-type"] = "text/plain";
		} else if (Buffer.isBuffer(body)) {
			payload = body;
			req.headers["content-type"] = "application/octet-stream";
		} else {
			payload = JSON.stringify(body);
			req.headers["content-type"] = "application/json";
		}
		req.headers["content-length"] = `${payload.length}`;

		// 派发请求并等待响应：劫持 ServerResponse 的 write / end 以收集响应内容
		return new Promise<Webhook.Response>((resolve) => {
			const res = new ServerResponse(req);
			let body = "";
			// 响应体分块只会是字符串或 Buffer（Node HTTP 层的两种写出形态）
			res.write = (chunk: string | Buffer) => {
				body += chunk;
				return true;
			};
			res.end = (callback: () => void) => {
				const code = res.statusCode;
				const headers = res.getHeaders();
				resolve({ code, body, headers });
				if (typeof callback === "function") callback();
				return res;
			};
			this.ctx.server._http.emit("request", req, res);
			// 向 req 注入请求体，触发服务端读取
			req.emit("data", payload);
			req.emit("end");
		});
	}
}
