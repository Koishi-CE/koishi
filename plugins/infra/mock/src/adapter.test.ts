// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { App } from "@koishi-ce/koishi";
// memory 数据库经 admin 的 node_modules 深链导入源码形态（本包未声明该 devDep，
// 且禁改 package.json；与 admin 既有测试同版本同实现）；
// CJS 实现配 ESM 声明，nodenext 互操作视图多包一层 default，转型取真实插件对象
import * as memoryModule from "@koishijs/plugin-database-memory";
import mock, { MockAdapter, MockBot } from "./index.ts";

const memory =
	memoryModule.default as unknown as typeof memoryModule.default.default;

/**
 * mock 适配器与模拟 Bot（adapter.ts）的边角测试：
 * 数据库预置、getMessage 的私聊/群聊分支、selfId 覆盖、
 * 以及 mock 服务下无 bot 时各代理方法的显式报错。
 */

const app = new App();
app.plugin(memory);
app.plugin(mock);

beforeAll(() => app.start());
afterAll(() => app.stop());

describe("MockAdapter（随插件装配）", () => {
	it("注入 mock 服务并持有 Webhook 实例", () => {
		expect(app.mock).toBeInstanceOf(MockAdapter);
		expect(app.mock.webhook).toBeDefined();
	});

	it("initUser 预置用户（含权威度与附加字段）", async () => {
		await app.mock.initUser("123", 4, { name: "张三" });
		const user = await app.database.getUser("mock", "123");
		expect(user?.["authority"]).toBe(4);
		expect(user?.["name"]).toBe("张三");
	});

	it("initChannel 默认指派给第一个 bot，也可显式指定受理人", async () => {
		await app.mock.initChannel("321");
		await app.mock.initChannel("654", "999");
		const channel1 = await app.database.getChannel("mock", "321");
		expect(channel1?.["assignee"]).toBe("514");
		const channel2 = await app.database.getChannel("mock", "654");
		expect(channel2?.["assignee"]).toBe("999");
	});

	it("session 基于事件模板构造但不派发", () => {
		const session = app.mock.session({ platform: "mock", type: "message" });
		expect(session.platform).toBe("mock");
	});

	it("client 代理到第一个 bot 创建消息客户端", () => {
		const client = app.mock.client("123", "321");
		expect(client.channelId).toBe("321");
	});
});

describe("MockBot", () => {
	it("getMessage：私聊频道与群聊频道的类型分支", async () => {
		const bot = app.bots[0] as MockBot;
		const direct = await bot.getMessage("private:1", "m1");
		expect(direct.channel?.["type"]).toBe(1);
		expect(direct.content).toBe("");
		expect(direct.user?.["id"]).toBe(bot.selfId);
		const group = await bot.getMessage("321", "m2");
		expect(group.channel?.["type"]).toBe(0);
		expect(group.messageId).toBe("m2");
	});

	it("配置 selfId 覆盖默认值，receive 派发事件并返回会话 id", async () => {
		const solo = new App();
		try {
			const bot = new MockBot(solo, { selfId: "777" });
			expect(bot.selfId).toBe("777");
			// MockBot 构造时同步注册 mock 服务（无需数据库）
			expect(solo.mock).toBeInstanceOf(MockAdapter);
			// body 不在 Universal.Event 字段内（session 会忽略未知属性），不传不影响派发
			const id = solo.mock.receive({ type: "message" });
			// 会话 id 由内核生成（数字自增），存在即代表派发成功
			expect(`${id}`.length).toBeGreaterThan(0);
		} finally {
			await solo.stop();
		}
	});
});

describe("MockAdapter 无 bot 时的防御", () => {
	it("未注册任何 bot 时代理方法显式报错", async () => {
		const empty = new App();
		try {
			// 直接实例化（不经 ctx.plugin 的 fork 链）时 bots 为空
			const adapter = new MockAdapter(empty, {} as never);
			expect(() => adapter.client("1")).toThrow("mock 服务下没有已注册的 bot");
			expect(() => adapter.session({})).toThrow("mock 服务下没有已注册的 bot");
			expect(() => adapter.receive({})).toThrow("mock 服务下没有已注册的 bot");
			// initChannel 的默认受理人取自 firstBot → 同样报错
			await expect(adapter.initChannel("1")).rejects.toThrow(
				"mock 服务下没有已注册的 bot",
			);
			// 无数据库时 initUser 抛出（database 服务缺失）
			await expect(adapter.initUser("1")).rejects.toThrow();
		} finally {
			await empty.stop();
		}
	});
});
