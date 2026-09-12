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
import {
	type Client,
	EntryProvider,
} from "@koishi-ce/console";
import {
	App,
	type Dict,
	type Schema,
} from "@koishi-ce/koishi";
// schema / permission 两个内置服务未从包出口再导出，走包内相对路径引用
import { PermissionProvider } from "../permission.ts";
import { SchemaProvider } from "../schema.ts";
import {
	app,
	type ConsoleHost,
	FakeSocket,
	fakeRequest,
	readSent,
	service,
	startApp,
	stopApp,
	TestConsole,
	tick,
} from "./helpers.ts";

beforeAll(startApp);
afterAll(stopApp);

describe("@koishi-ce/console 基座", () => {
	describe("内置服务与 services 代理", () => {
		it("注册 entry / schema / permissions 三个内置数据服务", () => {
			expect(service.services.entry).toBeInstanceOf(
				EntryProvider,
			);
			expect(service.services.schema).toBeInstanceOf(
				SchemaProvider,
			);
			expect(service.services.permissions).toBeInstanceOf(
				PermissionProvider,
			);
		});

		it("services 按名惰性解析，符号键直接透传", () => {
			const symbol = Symbol("probe");
			expect(
				(
					service.services as unknown as Record<
						symbol,
						unknown
					>
				)[symbol],
			).toBeUndefined();
			// 未注册的服务名解析为 undefined
			expect(
				(
					service.services as unknown as Record<
						string,
						unknown
					>
				)["nonexistent"],
			).toBeUndefined();
		});

		it("services 代理禁止写入", () => {
			expect(() => {
				(
					service.services as unknown as Record<
						string,
						unknown
					>
				)["entry"] = 1;
			}).toThrow();
		});

		it("内置 ping 监听器返回 pong", () => {
			// Listener.callback 的 this 形参类型为 Client，以最小桩满足调用形状
			const anyClient = { id: "ping-probe" } as Client;
			expect(
				service.listeners["ping"]?.callback.call(anyClient),
			).toBe("pong");
		});
	});

	describe("内置数据服务的读取与事件刷新", () => {
		it("schema / permissions 服务返回核心服务数据", async () => {
			const schema = await service.services.schema.get();
			expect(schema).toBe(
				(app.schema as unknown as { _data: Dict<Schema> })
					._data,
			);
			const permissions =
				await service.services.permissions.get();
			expect(Array.isArray(permissions)).toBe(true);
		});

		it("internal/schema 与 internal/permission 事件触发服务刷新", async () => {
			const socket = new FakeSocket();
			service.acceptClient(socket.socket, fakeRequest());
			await tick();
			socket.sent.length = 0;

			// internal/schema 事件签名要求携带 schema 名，载荷本身不参与断言
			app.emit("internal/schema", "probe");
			app.emit("internal/permission");
			await tick();
			const keys = readSent(socket).map(
				(msg) => msg.body.key,
			);
			expect(keys).toContain("schema");
			expect(keys).toContain("permissions");
			socket.shutdown();
		});
	});

	describe("宿主上下文销毁", () => {
		it("应用停止时清理入口与服务", async () => {
			// 以独立 App 验证宿主销毁链路：入口先于服务注销，服务停止后不可再解析
			const localApp = new App();
			localApp.plugin(TestConsole as ConsoleHost);
			await localApp.start();
			const localConsole = localApp.console as TestConsole;
			const socket = new FakeSocket();
			localConsole.acceptClient(
				socket.socket,
				fakeRequest(),
			);
			await tick();
			expect(socket.sent.length).toBeGreaterThan(0);

			const entry = localConsole.addEntry("late.js");
			expect(localConsole.entries[entry.id]).toBeTruthy();
			// 入口先于服务注销（其销毁回调会回访 console 服务并异步触发 entry 刷新），
			// 等一拍让刷新广播落地后再停止应用，避免异步回访撞上服务卸载
			entry.dispose();
			await tick();
			await localApp.stop();
			expect(localApp.get("console")).toBeUndefined();
			socket.shutdown();
		});
	});
});
