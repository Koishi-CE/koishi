// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
} from "bun:test";
import type { Client } from "@koishi-ce/console";
import { Logger } from "@koishi-ce/koishi";
import {
	app,
	FakeSocket,
	fakeRequest,
	readSent,
	service,
	startApp,
	stopApp,
	tick,
} from "./helpers.ts";

// 声明测试专用事件，供 addListener / listeners 索引走类型化键
declare module "@koishi-ce/console" {
	interface Events {
		"test/echo"(...args: unknown[]): unknown[];
		"test/secret"(): string;
		"test/boom"(): never;
	}
}

beforeAll(startApp);
afterAll(stopApp);

describe("@koishi-ce/console 基座", () => {
	describe("客户端接入与 RPC 分发", () => {
		it("accept 登记客户端并触发 connection 事件，close 时清理", async () => {
			const events: string[] = [];
			const dispose = app.on(
				"console/connection",
				(client) => {
					events.push(client.id);
				},
			);

			const socket = new FakeSocket();
			const client = service.acceptClient(
				socket.socket,
				fakeRequest(),
			);
			expect(service.clients[client.id]).toBe(client);
			expect(events).toEqual([client.id]);

			// 连接建立后触发首屏数据同步（entry 等内置服务立即下发）
			await tick();
			expect(
				readSent(socket).filter(
					(msg) => msg.type === "data",
				).length,
			).toBeGreaterThan(0);

			socket.shutdown();
			expect(service.clients[client.id]).toBeUndefined();
			expect(events).toEqual([client.id, client.id]);
			dispose();
		});

		it("未知事件回 not implemented，正常事件回传结果", async () => {
			// 未知事件的 console 域 info 是被测行为的预期伴生输出，静默之
			(Logger.levels as Record<string, number>)["console"] =
				0;
			try {
				const socket = new FakeSocket();
				const client = service.acceptClient(
					socket.socket,
					fakeRequest(),
				);
				await tick();
				socket.sent.length = 0;

				let boundId = "";
				let boundArg: unknown;
				service.addListener(
					"test/echo",
					function (this: Client, ...args) {
						boundId = this.id;
						boundArg = args[0];
						return args;
					},
				);

				socket.receive(
					JSON.stringify({
						type: "unknown-event",
						id: 1,
						args: [],
					}),
				);
				socket.receive(
					JSON.stringify({
						type: "test/echo",
						id: 2,
						args: ["hello"],
					}),
				);
				await tick();

				expect(readSent(socket)[0]).toEqual({
					type: "response",
					body: { id: 1, error: "not implemented" },
				});
				expect(readSent(socket)[1]).toEqual({
					type: "response",
					body: { id: 2, value: ["hello"] },
				});
				// 回调的 this 绑定为发起调用的客户端
				expect(boundId).toBe(client.id);
				expect(boundArg).toBe("hello");
				socket.shutdown();
			} finally {
				delete (Logger.levels as Record<string, number>)[
					"console"
				];
			}
		});

		it("回调抛错时回传 coerce 格式化的错误文本", async () => {
			const socket = new FakeSocket();
			service.acceptClient(socket.socket, fakeRequest());
			await tick();
			socket.sent.length = 0;

			service.addListener("test/boom", () => {
				throw new Error("boom");
			});
			socket.receive(
				JSON.stringify({
					type: "test/boom",
					id: 3,
					args: [],
				}),
			);
			await tick();

			const response = readSent(socket)[0];
			expect(response?.type).toBe("response");
			expect(response?.body.id).toBe(3);
			expect(String(response?.body.error)).toContain(
				"boom",
			);
			socket.shutdown();
		});

		it("console/intercept 拦截时回 unauthorized", async () => {
			const socket = new FakeSocket();
			service.acceptClient(socket.socket, fakeRequest());
			await tick();
			socket.sent.length = 0;

			let called = false;
			service.addListener(
				"test/secret",
				() => {
					called = true;
					return "s3cret";
				},
				{ authority: 5 },
			);
			const dispose = app.on(
				"console/intercept",
				(_client, options) => {
					return options.authority === 5;
				},
			);

			socket.receive(
				JSON.stringify({
					type: "test/secret",
					id: 4,
					args: [],
				}),
			);
			await tick();
			expect(readSent(socket)[0]).toEqual({
				type: "response",
				body: { id: 4, error: "unauthorized" },
			});
			expect(called).toBe(false);
			dispose();
			socket.shutdown();
		});
	});

	describe("广播", () => {
		it("向全部客户端广播静态与函数消息体", async () => {
			const socketA = new FakeSocket();
			const socketB = new FakeSocket();
			const clientA = service.acceptClient(
				socketA.socket,
				fakeRequest(),
			);
			const clientB = service.acceptClient(
				socketB.socket,
				fakeRequest(),
			);
			await tick();
			socketA.sent.length = 0;
			socketB.sent.length = 0;

			await service.broadcast("event", { static: true });
			await service.broadcast(
				"event",
				(client: Client) => ({
					who: client.id,
				}),
			);

			expect(socketA.sent).toHaveLength(2);
			expect(socketB.sent).toHaveLength(2);
			expect(readSent(socketA)[0]?.body).toEqual({
				static: true,
			});
			expect(readSent(socketA)[1]?.body).toEqual({
				who: clientA.id,
			});
			expect(readSent(socketB)[1]?.body).toEqual({
				who: clientB.id,
			});
			socketA.shutdown();
			socketB.shutdown();
		});

		it("被拦截器命中的客户端不参与广播；无客户端时为空操作", async () => {
			const socketA = new FakeSocket();
			const socketB = new FakeSocket();
			const clientA = service.acceptClient(
				socketA.socket,
				fakeRequest(),
			);
			service.acceptClient(socketB.socket, fakeRequest());
			await tick();
			socketA.sent.length = 0;
			socketB.sent.length = 0;

			const dispose = app.on(
				"console/intercept",
				(client) => {
					return client === clientA;
				},
			);
			await service.broadcast("blocked", null, {
				authority: 1,
			});
			expect(socketA.sent).toHaveLength(0);
			expect(socketB.sent).toHaveLength(1);
			dispose();

			// 两个连接都断开后广播应直接返回
			socketA.shutdown();
			socketB.shutdown();
			await expect(
				service.broadcast("nobody", 1),
			).resolves.toBeUndefined();
		});
	});
});
