// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import type { Context } from "@koishi-ce/koishi";
import { Webhook } from "./webhook.ts";

/**
 * Webhook（webhook.ts）的纯桩测试：不启动真实 HTTP 服务，
 * 以 EventEmitter 冒充 plugin-server 的底层 _http，直接验证
 * 「构造原生 req/res → 派发 request → 劫持 write/end 收集响应」的完整链路。
 */

/** 最近一次派发到服务的请求快照 */
interface ReqSnapshot {
	method: string;
	url: string;
	headers: Record<string, unknown>;
	body: string;
}

const http = new EventEmitter();
const ctx = {
	server: { _http: http },
} as unknown as Context;
const webhook = new Webhook(ctx);

let lastReq: ReqSnapshot | undefined;
let endCallbackCalled = false;

http.on("request", (req, res) => {
	const chunks: string[] = [];
	lastReq = {
		method: req.method,
		url: req.url,
		headers: { ...req.headers },
		body: "",
	};
	req.on("data", (chunk: string | Buffer) => {
		chunks.push(`${chunk}`);
	});
	req.on("end", () => {
		if (lastReq) lastReq.body = chunks.join("");
	});
	res.statusCode = 233;
	res.setHeader("x-custom", "yes");
	res.write("part1");
	res.write(Buffer.from("part2"));
	// /cb 路径验证 end(callback) 形态，其余验证无参 end
	if (req.url === "/cb") {
		res.end(() => {
			endCallbackCalled = true;
		});
	} else {
		res.end();
	}
});

/** 取最近一次请求快照（窄化为非空） */
function request(): ReqSnapshot {
	expect(lastReq).toBeDefined();
	return lastReq as ReqSnapshot;
}

describe("Webhook", () => {
	it("静态 inject 声明 server 服务", () => {
		expect(Webhook.inject).toContain("server");
	});

	it("GET：透传方法与路径，回传状态码 / 分块拼合的响应体 / 响应头", async () => {
		const res = await webhook.get("/foo?a=1", {
			authorization: "Bearer t",
		});
		expect(res.code).toBe(233);
		expect(res.body).toBe("part1part2");
		expect(res.headers["x-custom"]).toBe("yes");
		const req = request();
		expect(req.method).toBe("GET");
		expect(req.url).toBe("/foo?a=1");
		expect(req.headers["authorization"]).toBe("Bearer t");
	});

	it("HEAD：只返回响应头", async () => {
		const headers = await webhook.head("/head");
		expect(headers["x-custom"]).toBe("yes");
		expect(request().method).toBe("HEAD");
	});

	it("DELETE：无请求体方法同样可用", async () => {
		const res = await webhook.delete("/del");
		expect(res.code).toBe(233);
		expect(request().method).toBe("DELETE");
	});

	it("POST 对象序列化为 JSON 并补全 content-type / content-length", async () => {
		await webhook.post("/json", { foo: 1, bar: "baz" });
		const req = request();
		expect(req.method).toBe("POST");
		expect(req.headers["content-type"]).toBe(
			"application/json",
		);
		expect(req.body).toBe(
			JSON.stringify({ foo: 1, bar: "baz" }),
		);
		expect(req.headers["content-length"]).toBe(
			`${req.body.length}`,
		);
	});

	it("POST 字符串按 text/plain 原样发送", async () => {
		await webhook.post("/text", "纯文本");
		const req = request();
		expect(req.headers["content-type"]).toBe("text/plain");
		expect(req.body).toBe("纯文本");
	});

	it("PUT Buffer 按 application/octet-stream 发送", async () => {
		const payload = Buffer.from([1, 2, 3]);
		await webhook.put("/bin", payload);
		const req = request();
		expect(req.headers["content-type"]).toBe(
			"application/octet-stream",
		);
		expect(req.headers["content-length"]).toBe("3");
		expect(req.body).toBe("\x01\x02\x03");
	});

	it("PATCH：其余 HTTP 方法同链路", async () => {
		await webhook.patch("/p", { k: true });
		expect(request().method).toBe("PATCH");
		expect(request().headers["content-type"]).toBe(
			"application/json",
		);
	});

	it("res.end(callback) 形态会调用回调", async () => {
		endCallbackCalled = false;
		const res = await webhook.get("/cb");
		expect(res.code).toBe(233);
		expect(endCallbackCalled).toBe(true);
	});
});
