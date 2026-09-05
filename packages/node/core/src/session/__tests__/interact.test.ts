// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 会话交互层补充测试：prompt 对 @机器人 前缀的剥离。
 *
 * prompt 的无回调重载会把消息开头 @机器人 的元素剥掉只留正文，
 * 这里通过 mock 客户端的两次应答交互验证该行为。
 */
import {
	afterAll,
	beforeAll,
	describe,
	it,
} from "bun:test";
import { App } from "@koishi-ce/koishi";
import mock, {
	DEFAULT_SELF_ID,
} from "@koishi-ce/plugin-mock";

const app = new App();
app.plugin(mock);
const client = app.mock.client("123");

app.middleware(async (session, next) => {
	if (session.content !== "ask") return next();
	await session.send("请回复");
	const message = (await session.prompt()) ?? "无内容";
	await session.send(`收到 ${message}`);
});

beforeAll(() => app.start());
afterAll(() => app.stop());

describe("Session Interact", () => {
	it("prompt 剥离回复开头的 @机器人 元素", async () => {
		await client.shouldReply("ask", "请回复");
		// @机器人 + 正文：@ 前缀被剥离，只保留正文
		await client.shouldReply(
			`<at id="${DEFAULT_SELF_ID}"/> hello`,
			"收到 hello",
		);
	});
});
