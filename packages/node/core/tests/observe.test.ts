// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 会话数据装配层（SessionObservable）测试。
 *
 * 覆盖频道/用户数据的查询、创建与观察语义：
 * - 空字段集的轻量对象返回；
 * - autoAssign / autoAuthorize 关闭时的游离（$detached）数据与写回拦截；
 * - autoAssign 开启时的入库创建；
 * - 群聊频道的 channel / guild 双观察；
 * - 观察缓存的字段补查合并（$merge）与全命中复用；
 * - 匿名用户的内存临时观察对象。
 */
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
} from "bun:test";
import { App, type Session } from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";
import * as memoryModule from "@koishijs/plugin-database-memory";
import "./shape.ts";

// CJS 实现配 ESM 声明，Bun 互操作视图多包一层 default，穿透取真实驱动
const memory =
	memoryModule.default as unknown as typeof memoryModule.default.default;

const app = new App();
app.plugin(mock);
app.plugin(memory);
const bot = app.bots[0]!;

/** 构造带完整标识信息的会话 */
function createSession(overrides: {
	channelId: string;
	guildId?: string;
	userId?: string;
	anonymous?: unknown;
}) {
	const userId = overrides.userId ?? "123";
	const user: Record<string, unknown> = {
		id: userId,
		name: userId,
	};
	// author 是 event.user 的浅拷贝，anonymous 须挂在 event.user 上
	if (overrides.anonymous !== undefined)
		user["anonymous"] = overrides.anonymous;
	const session = bot.session({
		platform: "mock",
		selfId: bot.selfId,
		channel: { id: overrides.channelId, type: 0 },
		guild: { id: overrides.guildId ?? overrides.channelId },
		user: user as never,
	}) as Session;
	session.channelId = overrides.channelId;
	session.guildId =
		overrides.guildId ?? overrides.channelId;
	session.isDirect = false;
	return session;
}

beforeAll(() => app.start());
afterAll(() => app.stop());

describe("Session Observable", () => {
	it("getChannel 空字段集返回轻量对象", async () => {
		const session = createSession({
			channelId: "C1",
			guildId: "G1",
		});
		await expect(
			session.getChannel("C1"),
		).resolves.toHaveShape({
			platform: "mock",
			id: "C1",
			guildId: "G1",
		});
	});

	it("autoAssign 关闭时频道为游离数据且不落库", async () => {
		app.koishi.config.autoAssign = false;
		const session = createSession({
			channelId: "DETACHED",
		});
		const channel = await session.getChannel("DETACHED", [
			"flag",
		]);
		expect(
			(channel as { $detached?: boolean }).$detached,
		).toBe(true);
		// 游离频道的修改不会写回数据库
		const observed = await session.observeChannel(["flag"]);
		// 观察类型只暴露预取字段，assignee 经形状视图写入
		(observed as { assignee?: string }).assignee = "999";
		await (
			observed as unknown as { $update(): Promise<void> }
		).$update();
		await expect(
			app.database.getChannel("mock", "DETACHED"),
		).resolves.toBeUndefined();
		app.koishi.config.autoAssign = true;
	});

	it("autoAssign 开启时频道入库并指派给本 bot", async () => {
		const session = createSession({ channelId: "CREATED" });
		await session.getChannel("CREATED", ["flag"]);
		await expect(
			app.database.getChannel("mock", "CREATED"),
		).resolves.toHaveShape({ assignee: bot.selfId });
	});

	it("observeChannel 群聊同时观察 channel 与 guild", async () => {
		const session = createSession({
			channelId: "CH",
			guildId: "GD",
		});
		await app.database.createChannel("mock", "CH", {
			assignee: bot.selfId,
		});
		await app.database.createChannel("mock", "GD", {
			assignee: bot.selfId,
		});
		const channel = await session.observeChannel([
			"assignee",
		]);
		// 观察类型只暴露预取字段，主键 id 经形状视图读取
		expect((channel as { id?: string }).id).toBe("CH");
		expect(
			(session.channel as { id?: string } | undefined)?.id,
		).toBe("CH");
		// channelId 与 guildId 不同时 guild 是独立观察对象
		expect(
			(session.guild as { id?: string } | undefined)?.id,
		).toBe("GD");
		expect(session.guild).not.toBe(session.channel);
	});

	it("getUser 空字段集返回空对象", async () => {
		const session = createSession({ channelId: "C2" });
		// 空字段集时运行时返回空对象，声明类型为完整实体，按 object 视图断言
		const user = await session.getUser();
		expect(user as object).toEqual({});
	});

	it("observeUser 新用户按默认等级入库", async () => {
		const session = createSession({
			channelId: "C3",
			userId: "u-create",
		});
		const user = await session.observeUser([
			"authority",
			"name",
		]);
		expect(user.authority).toBe(1);
		await expect(
			app.database.getUser("mock", "u-create"),
		).resolves.toHaveShape({ authority: 1 });
	});

	it("observeUser 缓存命中时合并缺失字段", async () => {
		// 预置带 name 的用户，观察后分两次请求不同字段
		await app.database.createUser("mock", "u-merge", {
			authority: 1,
			name: "u-merge",
		});
		const session = createSession({
			channelId: "C4",
			userId: "u-merge",
		});
		const first = await session.observeUser(["authority"]);
		// 第二次请求包含新字段：触发查询并 $merge 进既有观察对象
		const merged = await session.observeUser(["name"]);
		// 两次观察的字段集不同，同一性断言按 object 视图比较
		expect(merged as object).toBe(first);
		expect(merged).toHaveShape({
			authority: 1,
			name: "u-merge",
		});
		// 全部字段已缓存的再次观察直接复用
		const again = await session.observeUser(["name"]);
		expect(again as object).toBe(first);
	});

	it("autoAuthorize 为 0 时用户为游离数据且不落库", async () => {
		app.koishi.config.autoAuthorize = 0;
		const session = createSession({
			channelId: "C5",
			userId: "u-detach",
		});
		const user = await session.observeUser(["authority"]);
		expect(
			(user as { $detached?: boolean }).$detached,
		).toBe(true);
		expect(user.authority).toBe(0);
		// name 未在观察字段集中，经形状视图写入
		(user as { name?: string }).name = "ghost";
		await (
			user as unknown as { $update(): Promise<void> }
		).$update();
		await expect(
			app.database.getUser("mock", "u-detach"),
		).resolves.toBeUndefined();
		app.koishi.config.autoAuthorize = 1;
	});

	it("匿名用户使用内存临时对象", async () => {
		const session = createSession({
			channelId: "C6",
			userId: "u-anon",
			anonymous: { name: "隐身人" },
		});
		const user = await session.observeUser(["authority"]);
		expect(user.authority).toBe(1);
		// 匿名用户不入库
		await expect(
			app.database.getUser("mock", "u-anon"),
		).resolves.toBeUndefined();
	});
});
