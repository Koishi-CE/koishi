// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * Session API 测试。
 *
 * 覆盖三块能力：
 * - 指令执行与插值（`$(...)` 嵌套展开）；
 * - session.prompt 一次性提问（正常回复与超时）；
 * - autoAuthorize=0 时新用户的权限拦截（指令被拒）与
 *   游离用户数据（middleware 中仍可读写 user 字段）。
 */
import { afterAll, beforeAll, describe, it } from "bun:test";
import { App, sleep } from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";
import * as memoryModule from "@koishijs/plugin-database-memory";

// CJS 实现配 ESM 声明，Bun 互操作视图多包一层 default，穿透取真实驱动
const memory =
	memoryModule.default as unknown as typeof memoryModule.default.default;

describe("Session API", () => {
	describe("Command Execution", () => {
		const app = new App();
		app.plugin(mock);
		const client = app.mock.client("456");

		app.command("echo [content:text]").action((_, text) => text);
		app
			.command("exec [command:text]")
			.action(({ session }, text) => session!.execute(text));

		beforeAll(() => app.start());
		afterAll(() => app.stop());

		it("basic support", async () => {
			// echo 基本回复，以及通过 session.execute 二次执行指令
			await client.shouldReply("echo 0", "0");
			await client.shouldReply("exec echo 0", "0");
		});

		it("interpolate 1", async () => {
			// $(...) 插值：内层指令输出回填到外层参数，含拼接与多空格场景
			await client.shouldReply("echo $(echo 0)", "0");
			await client.shouldReply("echo $(exec echo 0)", "0");
			await client.shouldReply("echo 1$(echo 0)2", "102");
			await client.shouldReply("echo 1 $(echo 0)  2", "1 0  2");
		});

		it("interpolate 2", async () => {
			// 插值嵌套：内层插值先展开再执行外层
			await client.shouldReply("echo $(echo $(echo 0))", "0");
			await client.shouldReply("echo 1 $(echo $(echo 0))2", "1 02");
		});
	});

	describe("Other Session Methods", () => {
		const app = new App({ prefix: "." });
		app.plugin(mock);
		const client = app.mock.client("123", "456");

		beforeAll(() => app.start());
		afterAll(() => app.stop());

		app.middleware(async (session, next) => {
			if (session.content !== "prompt") return next();
			await session.send("prompt text");
			const message = (await session.prompt()) || "nothing";
			await session.send(`received ${message}`);
		});

		it("session.prompt 1", async () => {
			// prompt 收到用户后续消息；未匹配的重复输入不再触发回复
			await client.shouldReply("prompt", "prompt text");
			await client.shouldReply("foo", "received foo");
			await client.shouldNotReply("foo");
		});

		it("session.prompt 2", async () => {
			// prompt 超时（delay.prompt=0 立即超时）走兜底值 "nothing"
			app.koishi.config.delay!.prompt = 0;
			await client.shouldReply("prompt", "prompt text");
			await sleep(0);
			await client.shouldReply("foo", "received nothing");
		});
	});

	it("autoAuthorize", async () => {
		// 初始等级 0：指令因权限不足被拒；中间件仍能正常读写用户字段
		const app = new App({ autoAuthorize: 0 });
		app.plugin(mock);
		app.plugin(memory);
		app.command("foo").action(() => "foo");
		app.middleware(async (session) => {
			Object.assign(session.user!, { name: "bar" });
			return "bar";
		});
		await app.start();
		const client = app.mock.client("123", "456");
		await client.shouldReply("foo", "权限不足。");
		await client.shouldReply("bar", "bar");
	});
});
