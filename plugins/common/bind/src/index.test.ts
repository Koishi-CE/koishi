// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * bind 插件测试：用两个 mock 客户端模拟跨平台用户，
 * 验证两步令牌绑定流程与解绑（含原初账号保护）。
 */
import { afterAll, beforeAll, describe, it } from "bun:test";
import { Context } from "@koishi-ce/koishi";
import * as bind from "@koishi-ce/plugin-bind";
import mock from "@koishi-ce/plugin-mock";
import memory from "@minatojs/driver-memory";

const app = new Context();

let counter = 0;

app.plugin(bind, {
	generateToken: () => `koishi/${(++counter).toString().padStart(6, "0")}`,
});

app.plugin(mock);
app.plugin(memory);

app
	.command("name")
	.userFields(["name"])
	.action(({ session }) => session!.username);

const client1 = app.mock.client("123", "321");
const client2 = app.mock.client("456", "654");

beforeAll(async () => {
	await app.start();
	await app.mock.initUser("123", 1, { name: "foo" });
	await app.mock.initUser("456", 1, { name: "bar" });
});

afterAll(() => app.stop());

describe("@koishi-ce/plugin-bind", () => {
	// 两用户经两枚令牌完成绑定后，两侧昵称应统一为被绑定者的昵称
	it("create binding", async () => {
		await client1.shouldReply("name", "foo");
		await client2.shouldReply("name", "bar");
		await client1.shouldReply("bind", /^koishi\/000001$/m);
		await client1.shouldReply("koishi/000001", "请前往原始平台输入。");
		await client2.shouldReply("koishi/000001", /^koishi\/000002$/m);
		await client2.shouldReply("koishi/000002", "请前往目标平台输入。");
		await client1.shouldReply("koishi/000002", "账号绑定成功！");
		await client1.shouldReply("name", "bar");
		await client2.shouldReply("name", "bar");
	});

	// 解绑：原初账号受保护不可解绑；迁移绑定的账号解绑后各回各的昵称
	it("remove binding", async () => {
		await client2.shouldReply("bind -r", "无法解除绑定：这是你的原始账号。");
		await client1.shouldReply("bind -r", "账号解绑成功！");
		await client1.shouldReply("name", "foo");
		await client2.shouldReply("name", "bar");
		await client1.shouldReply("bind -r", "无法解除绑定：这是你的原始账号。");
	});
});
