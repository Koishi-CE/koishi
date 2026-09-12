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
import type { DataService } from "@koishi-ce/console";
import {
	app,
	BlockedService,
	Counter,
	EmptyService,
	type EntryItem,
	FakeSocket,
	fakeRequest,
	ImmediateCounter,
	readSent,
	service,
	startApp,
	stopApp,
	tick,
} from "./helpers.ts";

beforeAll(startApp);
afterAll(stopApp);

describe("@koishi-ce/console 基座", () => {
	describe("入口（Entry）", () => {
		it("addEntry 注册入口并随 get 下发（含 data 工厂与 loader 路径）", async () => {
			const socket = new FakeSocket();
			const client = service.acceptClient(
				socket.socket,
				fakeRequest(),
			);
			await tick();

			// 无 loader 时路径字段缺省
			const entry = service.addEntry(
				["a.js", "b.js"],
				() => ({ v: 1 }),
			);
			const data = await service.get(client);
			const entryData = (
				data as Record<string, EntryItem | string>
			)[entry.id] as EntryItem | undefined;
			expect(entryData?.files).toEqual([
				`/assets/${entry.id}/a.js`,
				`/assets/${entry.id}/b.js`,
			]);
			expect(entryData?.paths).toBeUndefined();
			expect(entryData?.data).toEqual({ v: 1 });
			expect(typeof data._id).toBe("string");

			// 提供 loader 后路径随入口下发；注册入口即触发 entry 服务刷新
			app.provide("loader", {
				paths: () => ["group:entry", "plugins"],
			});
			const withPaths = await service.get(client);
			const withPathsEntry = (
				withPaths as Record<string, EntryItem | string>
			)[entry.id] as EntryItem | undefined;
			expect(withPathsEntry?.paths).toEqual([
				"group:entry",
				"plugins",
			]);
			await tick();
			expect(
				readSent(socket).filter(
					(msg) =>
						msg.type === "data" && msg.body.key === "entry",
				).length,
			).toBeGreaterThan(0);

			entry.dispose();
			expect(service.entries[entry.id]).toBeUndefined();
			socket.shutdown();
		});

		it("Entry.refresh 广播 entry-data 消息", async () => {
			const socket = new FakeSocket();
			service.acceptClient(socket.socket, fakeRequest());
			await tick();

			const entry = service.addEntry(
				"single.js",
				() => "payload",
			);
			await tick();
			socket.sent.length = 0;
			// refresh 不返回广播 Promise，等待一拍让消息落地
			entry.refresh();
			await tick();
			expect(readSent(socket)[0]).toEqual({
				type: "entry-data",
				body: { id: entry.id, data: "payload" },
			});
			entry.dispose();
			socket.shutdown();
		});
	});

	describe("DataService", () => {
		it("refresh 广播全量数据，patch 广播增量补丁", async () => {
			const socket = new FakeSocket();
			service.acceptClient(socket.socket, fakeRequest());
			await tick();

			const fork = app.plugin(Counter);
			// 非 immediate 服务在 ready 后才 set 进容器，先等一拍再手动刷新
			await tick(30);
			await service.refresh("counter" as never);
			await service.patch("counter" as never, 100);
			await tick();

			const messages = readSent(socket).filter(
				(msg) => msg.body.key === "counter",
			);
			const dataValues = messages
				.filter((msg) => msg.type === "data")
				.map((msg) => msg.body.value);
			// 服务启动的自动刷新与手动 refresh 各推送一次，值单调递增
			expect(dataValues.length).toBeGreaterThanOrEqual(2);
			for (const value of dataValues) {
				expect(value).toBeGreaterThan(0);
			}
			expect(
				messages.find((msg) => msg.type === "patch")?.body
					.value,
			).toBe(100);
			fork.dispose();
			socket.shutdown();
		});

		it("immediate 服务在启动时自动推送首屏数据", async () => {
			const socket = new FakeSocket();
			service.acceptClient(socket.socket, fakeRequest());
			await tick();
			socket.sent.length = 0;

			const fork = app.plugin(ImmediateCounter);
			await tick(30);
			expect(
				readSent(socket).find(
					(msg) =>
						msg.type === "data" &&
						msg.body.key === "immediate",
				)?.body.value,
			).toBe(42);
			fork.dispose();
			socket.shutdown();
		});

		it("首屏同步跳过空值数据，被拦截服务下发 null", async () => {
			const emptyFork = app.plugin(EmptyService);
			const blockedFork = app.plugin(BlockedService);
			// 先等服务启动期的自动刷新落定（此时无客户端，广播为空操作）
			await tick(30);
			const socket = new FakeSocket();
			// 拦截 authority 门槛为 7 的服务
			const dispose = app.on(
				"console/intercept",
				(_client, options) => {
					return options.authority === 7;
				},
			);

			const client = service.acceptClient(
				socket.socket,
				fakeRequest(),
			);
			await tick();
			socket.sent.length = 0;
			client.refresh();
			await tick();
			// 两个服务 get 均返回 null：不产生任何首屏消息
			const messages = readSent(socket).filter(
				(msg) => msg.type === "data",
			);
			expect(
				messages.find((msg) => msg.body.key === "empty"),
			).toBeUndefined();
			expect(
				messages.find((msg) => msg.body.key === "blocked"),
			).toBeUndefined();

			// 为 blocked 补上 authority 门槛后应下发 null
			const blocked = app.get(
				"console.services.blocked",
			) as DataService;
			blocked.options = { authority: 7 };
			socket.sent.length = 0;
			client.refresh();
			await tick();
			expect(
				readSent(socket).find(
					(msg) =>
						msg.type === "data" &&
						msg.body.key === "blocked",
				)?.body.value,
			).toBeNull();

			dispose();
			emptyFork.dispose();
			blockedFork.dispose();
			socket.shutdown();
		});
	});
});
