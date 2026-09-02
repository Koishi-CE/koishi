// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { App } from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";
import * as memoryModule from "@koishijs/plugin-database-memory";
import admin from "../index.ts";

// 同 index.test.ts：CJS 实现配 ESM 声明，nodenext 互操作视图多包一层 default
const memory =
	memoryModule.default as unknown as typeof memoryModule.default.default;

/**
 * 聊天指令（command.ts）的补充测试：locale 子指令族（user/channel 的
 * 设置 / 查询 / 重置 / 未设置文案）、assign 的 -r 重置、-u 指向当前
 * 用户的短路分支与目标不存在时的 not-found 路径。
 * 断言一律使用 bun:test 的 expect（存量 chai 用例不在本文件扩展）。
 */

const app = new App();

app.plugin(memory);
app.plugin(mock);
app.plugin(admin);

const client = app.mock.client("123", "321");

beforeAll(async () => {
	await app.start();
	await app.mock.initUser("123", 4);
	await app.mock.initUser("456", 2);
	await app.mock.initChannel("321");
});

afterAll(() => app.stop());

describe("locale 子指令与装饰器补充分支", () => {
	it("user/locale：设置 / 查询 / 重置 / 未设置查询", async () => {
		await client.shouldReply("user.locale -u @456", "未设置语言偏好。");
		await client.shouldReply("user.locale -u @456 zh-CN", "用户数据已修改。");
		await client.shouldReply("user.locale -u @456", "当前语言偏好为：zh-CN。");
		await client.shouldReply("user.locale -u @456 -r", "用户数据已修改。");
		await client.shouldReply("user.locale -u @456", "未设置语言偏好。");
	});

	it("user/locale：-u 指向当前用户时直接作用（短路分支）", async () => {
		await client.shouldReply("user.locale -u @123 en-US", "用户数据已修改。");
		await client.shouldReply("user.locale -u @123", "当前语言偏好为：en-US。");
		await client.shouldReply("user.locale -u @123 -r", "用户数据已修改。");
	});

	it("user/locale：目标用户不存在时报错（无 upsert）", async () => {
		await client.shouldReply("user.locale -u @777 zh", "未找到指定的用户。");
	});

	it("channel/locale：设置 / 查询 / 重置", async () => {
		await client.shouldReply("channel.locale -c #321", "未设置语言偏好。");
		await client.shouldReply(
			"channel.locale -c #321 zh-CN",
			"频道数据已修改。",
		);
		await client.shouldReply(
			"channel.locale -c #321",
			"当前语言偏好为：zh-CN。",
		);
		await client.shouldReply("channel.locale -c #321 -r", "频道数据已修改。");
	});

	it("channel/locale：目标频道不存在时报错（无 upsert）", async () => {
		await client.shouldReply("channel.locale -c #333 zh", "未找到指定的频道。");
	});

	it("channel/assign：-r 重置受理人", async () => {
		await client.shouldReply("assign -c #321 -r", "频道数据已修改。");
		const channel = await app.database.getChannel("mock", "321");
		expect(channel?.["assignee"]).toBe("");
	});
});
