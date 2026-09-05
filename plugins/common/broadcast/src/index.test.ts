// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * broadcast 插件测试：用两个 mock bot 验证全局广播、
 * 仅本 bot 广播（-o）与静默频道过滤（-f）的目标频道集合。
 */
import {
	beforeAll,
	describe,
	expect,
	it,
	jest,
} from "bun:test";
import { App, type Bot, Channel } from "@koishi-ce/koishi";
import * as broadcast from "@koishi-ce/plugin-broadcast";
import memory from "@koishi-ce/plugin-database-memory";
import mock from "@koishi-ce/plugin-mock";

const app = new App({
	delay: { broadcast: 0 },
});

app.plugin(mock, { selfId: "514" });
app.plugin(mock, { selfId: "114" });
app.plugin(memory);
app.plugin(broadcast);

const client = app.mock.client("123");

beforeAll(async () => {
	await app.start();
	await app.mock.initUser("123", 4);
	await app.mock.initChannel("111", "114");
	await app.mock.initChannel("222", "514");
	await app.mock.initChannel("333", "514", {
		flag: Channel.Flag.silent,
	});
	await app.mock.initChannel("444", "810");
});

describe("@koishi-ce/plugin-broadcast", () => {
	// 拦截各 bot 的 sendMessage，断言广播命中了正确的频道且静默频道被正确跳过或强制发送
	it("basic support", async () => {
		// 在拦截前验证缺参数提示（此时回复链路完整，消息能送达 mock 客户端）
		await client.shouldReply(
			"broadcast",
			"请输入要发送的文本。",
		);

		// 替换 sendMessage 为仅记录参数的 mock；返回空 ID 列表以维持 bot.broadcast 的展开推送
		const send1 = (app.bots.find(
			(bot) => bot.selfId === "514",
		)!.sendMessage = jest.fn<Bot["sendMessage"]>(
			async () => [],
		));
		const send2 = (app.bots.find(
			(bot) => bot.selfId === "114",
		)!.sendMessage = jest.fn<Bot["sendMessage"]>(
			async () => [],
		));

		await client.shouldNotReply("broadcast foo");
		// 全局广播：两个 bot 各发送被指派的频道，静默频道 333 被跳过
		expect(send1.mock.calls).toHaveLength(1);
		expect(send1.mock.calls[0]?.[0]).toBe("222");
		expect(send2.mock.calls).toHaveLength(1);
		expect(send2.mock.calls[0]?.[0]).toBe("111");
		send1.mockClear();
		send2.mockClear();

		await client.shouldNotReply("broadcast -o foo");
		// 仅本 bot：只发送当前 bot（514）被指派的频道，114 不发送
		expect(send1.mock.calls).toHaveLength(1);
		expect(send1.mock.calls[0]?.[0]).toBe("222");
		expect(send2.mock.calls).toHaveLength(0);
		send1.mockClear();

		await client.shouldNotReply("broadcast -of foo");
		// 强制模式：静默频道 333 也被发送
		expect(send1.mock.calls).toHaveLength(2);
		expect(send1.mock.calls[0]?.[0]).toBe("222");
		expect(send1.mock.calls[1]?.[0]).toBe("333");
	});
});
