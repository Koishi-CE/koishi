// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * bind 插件补充用例（bun:test 断言）：
 * 私聊令牌一步完成绑定、原初绑定不止一个时解绑另建新用户承接、
 * 以及未注入生成器时走默认随机数字令牌路径。
 */
import { afterAll, beforeAll, describe, expect, it, jest } from "bun:test";
import { Context } from "@koishi-ce/koishi";
import * as bind from "@koishi-ce/plugin-bind";
import mock from "@koishi-ce/plugin-mock";
import memory from "@minatojs/driver-memory";

// 主应用：注入确定性令牌生成器，便于跨客户端传递令牌
const app = new Context();

let counter = 0;

app.plugin(bind, {
	generateToken: () => `koishi/${(++counter).toString().padStart(6, "0")}`,
});

app.plugin(mock);
app.plugin(memory);

// 群聊客户端（绑定发起方）与私聊客户端（令牌签发方）
const group = app.mock.client("123", "321");
const direct = app.mock.client("456");

// 副应用：不注入 generateToken，验证默认随机令牌生成器
const appPlain = new Context();

appPlain.plugin(bind);
appPlain.plugin(mock);
appPlain.plugin(memory);

const plain = appPlain.mock.client("111");

beforeAll(async () => {
	await app.start();
	await app.mock.initUser("123", 1);
	await app.mock.initUser("456", 1);
	await appPlain.start();
	await appPlain.mock.initUser("111", 1);
});

afterAll(async () => {
	await app.stop();
	await appPlain.stop();
});

/** 从机器人文案中提取 koishi/ 前缀的六位数字令牌 */
function extractToken(message: string | undefined) {
	const token = message?.match(/koishi\/\d{6}/)?.[0];
	expect(token).toBeTypeOf("string");
	return token as string;
}

describe("@koishi-ce/plugin-bind 补充用例", () => {
	it("私聊签发的令牌可一步完成绑定", async () => {
		const replies = await direct.receive("bind");
		const token = extractToken(replies[0]);
		const [reply] = await group.receive(token);
		expect(reply).toBe("账号绑定成功！");
		// 私聊账号应并入群聊账号所属的内部用户
		const [groupBinding] = await app.database.get("binding", { pid: "123" });
		const [directBinding] = await app.database.get("binding", { pid: "456" });
		// 前置 receive 已保证两条绑定存在，非空断言仅消除索引访问的 undefined 分支
		expect(directBinding!.aid).toBe(groupBinding!.aid);
	});

	it("原初绑定不止一个时解绑会另建新用户承接", async () => {
		// 预置第二条原初绑定，使当前用户名下有两条 aid === bid 的记录
		const [self] = await app.database.get("binding", { pid: "123" });
		await app.database.create("binding", {
			platform: "mock",
			pid: "789",
			aid: self!.aid,
			bid: self!.aid,
		});
		const usersBefore = await app.database.get("user", {});
		const [reply] = await group.receive("bind -r");
		expect(reply).toBe("账号解绑成功！");
		// 当前平台账号被划入新建用户名下，而非删除绑定记录
		const usersAfter = await app.database.get("user", {});
		expect(usersAfter.length).toBe(usersBefore.length + 1);
		const [moved] = await app.database.get("binding", { pid: "123" });
		expect(moved!.aid).not.toBe(self!.aid);
		const [newcomer] = await app.database.get("user", { id: moved!.aid });
		expect(newcomer).toBeDefined();
	});

	it("第二步令牌签发者的绑定被删除时静默忽略", async () => {
		// 群聊第一步：签发 phase 1 令牌
		const [first] = await group.receive("bind");
		const token1 = extractToken(first);
		// 私聊第二步：核验成功并签发 phase -1 令牌
		const [second] = await direct.receive(token1);
		const token2 = extractToken(second);
		// 模拟签发者账号的绑定入口被删除，令牌失效后无任何回复
		await app.database.remove("binding", { pid: "456" });
		const replies = await group.receive(token2);
		expect(replies).toEqual([]);
	});

	it("令牌超过 5 分钟后自动过期失效", async () => {
		jest.useFakeTimers();
		const replies = await group.receive("bind");
		const token = extractToken(replies[0]);
		// 推进 5 分钟：过期回调删除令牌，此后该文本不再触发绑定流程
		jest.advanceTimersByTime(5 * 60_000);
		const again = await group.receive(token);
		expect(again).toEqual([]);
		jest.useRealTimers();
	});

	it("未注入生成器时使用默认随机数字令牌", async () => {
		const replies = await plain.receive("bind");
		expect(replies[0]).toMatch(/koishi\/\d{6}/);
	});
});
