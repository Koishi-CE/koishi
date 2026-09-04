// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 数据库 API 测试。
 *
 * 使用 memory 驱动（内存数据库）验证 user / channel 两表的
 * 领域方法语义：对不存在记录的 set 应报错 / 无效，create 后可查、
 * 可更新，以及 getAssignedChannels 按受理人过滤与批量 getChannel。
 */
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
} from "bun:test";
import { App } from "@koishi-ce/koishi";
import mock, {
	DEFAULT_SELF_ID,
} from "@koishi-ce/plugin-mock";
import * as memoryModule from "@koishijs/plugin-database-memory";
import "./shape.ts";

// CJS 实现配 ESM 声明，Bun 互操作视图多包一层 default，穿透取真实驱动
const memory =
	memoryModule.default as unknown as typeof memoryModule.default.default;

const app = new App();

app.plugin(mock);
app.plugin(memory);

beforeAll(() => app.start());
afterAll(() => app.stop());

describe("Database API", () => {
	describe("User Operations", () => {
		it("db.setUser() on non-existing user", async () => {
			// 未创建的用户：set 抛错，get 返回空
			await expect(
				app.database.setUser("mock", "A", { authority: 1 }),
			).rejects.toThrow();
			await expect(
				app.database.getUser("mock", "A"),
			).resolves.toBeUndefined();
		});

		it("db.createUser() on non-existing user", async () => {
			// create 后即可按 (platform, pid) 查到
			await app.database.createUser("mock", "A", {
				authority: 1,
			});
			await expect(
				app.database.getUser("mock", "A"),
			).resolves.toHaveShape({
				authority: 1,
			});
		});

		it("db.setUser() on existing user", async () => {
			// 已存在用户可正常更新字段
			await app.database.setUser("mock", "A", {
				authority: 2,
			});
			await expect(
				app.database.getUser("mock", "A"),
			).resolves.toHaveShape({
				authority: 2,
			});
		});
	});

	describe("Channel Operations", () => {
		it("db.setChannel() on non-existing channel", async () => {
			// 未创建的频道：set 不报错但也不产生记录
			await app.database.setChannel("mock", "A", {
				assignee: "123",
			});
			await expect(
				app.database.getChannel("mock", "A"),
			).resolves.toBeUndefined();
		});

		it("db.createChannel() on non-existing channel", async () => {
			await app.database.createChannel("mock", "A", {
				assignee: "123",
			});
			await expect(
				app.database.getChannel("mock", "A"),
			).resolves.toHaveShape({
				assignee: "123",
			});
		});

		it("db.setChannel() on existing channel", async () => {
			await app.database.setChannel("mock", "A", {
				assignee: "321",
			});
			await expect(
				app.database.getChannel("mock", "A"),
			).resolves.toHaveShape({
				assignee: "321",
			});
		});

		it("db.getAssignedChannels()", async () => {
			// 只返回受理人为在线 bot 的频道；selfIdMap 可进一步收窄范围
			await app.database.createChannel("mock", "B", {
				assignee: DEFAULT_SELF_ID,
			});
			await app.database.createChannel("mock", "C", {
				assignee: DEFAULT_SELF_ID,
			});
			await expect(
				app.database.getAssignedChannels(undefined),
			).resolves.toHaveLength(2);
			await expect(
				app.database.getAssignedChannels(undefined, {
					mock: ["321"],
				}),
			).resolves.toHaveLength(1);
		});

		it("db.getChannel() with multiple ids", async () => {
			// 批量重载返回数组；记录删除后为空数组
			await expect(
				app.database.getChannel("mock", ["A"]),
			).resolves.toHaveLength(1);
			await app.database.remove("channel", { id: "A" });
			await expect(
				app.database.getChannel("mock", ["A"]),
			).resolves.toEqual([]);
		});
	});
});
